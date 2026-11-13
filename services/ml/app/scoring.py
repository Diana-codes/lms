"""Transparent, rules-based credit score (BUILD_BRIEF §6, Phase 5).

Every point added or taken away is a named reason, so an officer can see
exactly why a score is what it is. The rules use repayment history, MoMo
inflow stability and affordability only. They never see gender, age,
district or any other protected characteristic: the input model rejects
unknown fields, and tests/test_fairness.py checks that.

The score is advice. Recommendations are AUTO_APPROVE_ELIGIBLE, APPROVE,
REVIEW or FLAG; there is deliberately no DECLINE.
"""

from __future__ import annotations

import math
from statistics import mean, pstdev
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MODEL_VERSION = "rules-v1"
SCORE_MIN, SCORE_MAX = 300, 850
BASE = 600

Recommendation = Literal["AUTO_APPROVE_ELIGIBLE", "APPROVE", "REVIEW", "FLAG"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class History(Strict):
    instalments_paid: int = Field(ge=0)
    paid_late: int = Field(ge=0)
    overdue_now: int = Field(ge=0, description="Instalments past due and unpaid today")
    months_as_customer: int = Field(ge=0)


class Affordability(Strict):
    monthly_income: int | None = Field(default=None, ge=0, description="Verified, RWF")
    stated_income: int | None = Field(default=None, ge=0, description="What the applicant told us, RWF")
    new_instalment: int = Field(ge=0)
    existing_instalments: int = Field(default=0, ge=0)
    limit_bps: int = Field(default=3500, ge=0, le=10_000)


class ScoreRequest(Strict):
    history: History
    affordability: Affordability
    momo_inflows: list[int] | None = Field(
        default=None, description="Monthly MoMo money-in, oldest first. Only with the borrower's consent."
    )


class Reason(BaseModel):
    kind: Literal["why", "watch"]
    text: str
    points: int


class ScoreResponse(BaseModel):
    value: int
    recommendation: Recommendation
    headline: str
    repay_probability_bps: int
    reasons: list[Reason]
    model_version: str = MODEL_VERSION


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def score(req: ScoreRequest) -> ScoreResponse:
    points = BASE
    reasons: list[Reason] = []
    flags: list[str] = []

    def add(delta: int, text: str) -> None:
        nonlocal points
        if delta == 0:
            return
        points += delta
        reasons.append(Reason(kind="why" if delta > 0 else "watch", text=text, points=delta))

    # 1. Repayment history with us.
    h = req.history
    if h.instalments_paid == 0:
        add(-20, "First loan with us: thin credit file")
    else:
        on_time = (h.instalments_paid - h.paid_late) / h.instalments_paid
        add(round(150 * min(1.0, max(-1.0, (on_time - 0.8) / 0.2))), f"{h.instalments_paid - h.paid_late} of {h.instalments_paid} instalments paid on time")
        if h.paid_late:
            add(-min(80, 10 * h.paid_late), f"{h.paid_late} instalment{'s' if h.paid_late != 1 else ''} paid late")
    if h.overdue_now:
        add(-min(150, 60 * h.overdue_now), f"{h.overdue_now} instalment{'s' if h.overdue_now != 1 else ''} overdue today")
        flags.append("overdue")
    add(min(h.months_as_customer, 36), f"Customer for {h.months_as_customer} months")

    # 2. MoMo inflow stability (only when shared with consent).
    inflows = [x for x in (req.momo_inflows or []) if x >= 0]
    momo_avg: float | None = None
    if len(inflows) >= 3:
        momo_avg = mean(inflows)
        cv = pstdev(inflows) / momo_avg if momo_avg > 0 else 9.0
        if cv < 0.15:
            add(60, "Very steady MoMo inflows")
        elif cv < 0.30:
            add(30, "Steady MoMo inflows")
        elif cv >= 0.50:
            add(-40, "MoMo inflows vary a lot month to month")
        half = len(inflows) // 2
        early, late = mean(inflows[:half]), mean(inflows[half:])
        if early > 0 and late < early * 0.7:
            add(-40, f"MoMo inflows down {_pct(1 - late / early)} recently")
    else:
        reasons.append(Reason(kind="watch", text="No MoMo history shared", points=0))

    # 3. Affordability: the brief's 35% rule (per product).
    a = req.affordability
    income = a.monthly_income or (int(momo_avg) if momo_avg else None) or a.stated_income
    total = a.new_instalment + a.existing_instalments
    affordable = False
    if income:
        ratio = total / income
        limit = a.limit_bps / 10_000
        affordable = ratio <= limit
        if ratio <= 0.20:
            add(40, f"Instalments would be {_pct(ratio)} of income")
        elif affordable:
            add(10, f"Instalments would be {_pct(ratio)} of income, within the {_pct(limit)} limit")
        else:
            add(-80, f"Instalments would be {_pct(ratio)} of income, above the {_pct(limit)} limit")
    else:
        reasons.append(Reason(kind="watch", text="No income to check affordability against", points=0))

    # 4. Stated income far above what MoMo shows.
    if a.stated_income and momo_avg and a.stated_income > 2 * momo_avg:
        add(-60, f"Stated revenue {a.stated_income / momo_avg:.1f}× MoMo inflows")
        flags.append("mismatch")

    value = max(SCORE_MIN, min(SCORE_MAX, points))
    probability = 1 / (1 + math.exp(-(value - 560) / 50))
    prob_bps = round(probability * 10_000)

    if "mismatch" in flags:
        rec: Recommendation = "FLAG"
        headline = "Flag · income mismatch"
    elif "overdue" in flags:
        rec, headline = "FLAG", "Flag · payment overdue now"
    elif value >= 730 and affordable and h.instalments_paid > 0:
        rec, headline = "AUTO_APPROVE_ELIGIBLE", "Auto-approve eligible"
    elif value >= 680 and affordable:
        rec, headline = "APPROVE", f"Approve · {round(probability * 100)}% likely to repay"
    elif h.instalments_paid == 0:
        rec, headline = "REVIEW", "Review · thin credit file"
    elif not affordable and income:
        rec, headline = "REVIEW", "Review · affordability"
    else:
        rec, headline = "REVIEW", "Review · needs a closer look"

    # Largest effects first, so the first reason is the main one.
    reasons.sort(key=lambda r: -abs(r.points))
    return ScoreResponse(value=value, recommendation=rec, headline=headline, repay_probability_bps=prob_bps, reasons=reasons)


# ── early warning ─────────────────────────────────────────────────────────


class WarningRequestItem(Strict):
    loan_id: str
    momo_inflows: list[int] | None = None
    paid_late_last_cycle: bool = False
    partial_payments_last_90_days: int = Field(default=0, ge=0)
    days_to_next_due: int


class WarningRequest(Strict):
    loans: list[WarningRequestItem] = Field(max_length=5000)


class Warning(BaseModel):
    loan_id: str
    signals: list[str]
    risk: Literal["high", "medium"]


class WarningResponse(BaseModel):
    flagged: list[Warning]
    model_version: str = MODEL_VERSION


def early_warning(req: WarningRequest) -> WarningResponse:
    """Borrowers who are up to date but show signs they may miss the next payment."""
    flagged: list[Warning] = []
    for item in req.loans:
        signals: list[str] = []
        inflows = item.momo_inflows or []
        if len(inflows) >= 4:
            before = mean(inflows[:-1])
            if before > 0 and inflows[-1] < before * 0.7:
                signals.append(f"MoMo inflows down {_pct(1 - inflows[-1] / before)} this month")
        if item.paid_late_last_cycle:
            signals.append("A payment made late last cycle")
        if item.partial_payments_last_90_days >= 2:
            signals.append(f"{item.partial_payments_last_90_days} part-payments in 90 days")
        if signals and item.days_to_next_due <= 30:
            flagged.append(Warning(loan_id=item.loan_id, signals=signals, risk="high" if len(signals) > 1 else "medium"))
    return WarningResponse(flagged=flagged)
