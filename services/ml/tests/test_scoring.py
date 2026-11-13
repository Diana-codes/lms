from fastapi.testclient import TestClient

from app.main import app
from app.scoring import SCORE_MAX, SCORE_MIN, Affordability, History, ScoreRequest, WarningRequest, WarningRequestItem, early_warning, score

client = TestClient(app)


def req(**kw) -> ScoreRequest:
    history = kw.pop("history", {"instalments_paid": 24, "paid_late": 0, "overdue_now": 0, "months_as_customer": 33})
    afford = kw.pop("affordability", {"monthly_income": 1_650_000, "new_instalment": 284_985})
    return ScoreRequest(history=History(**history), affordability=Affordability(**afford), **kw)


def test_strong_repeat_borrower_is_auto_approve_eligible() -> None:
    # Aline Uwase from the designs: 24 on time, steady MoMo, 17% of income.
    r = score(req(momo_inflows=[1_600_000, 1_620_000, 1_650_000, 1_590_000, 1_700_000, 1_640_000]))
    assert r.recommendation == "AUTO_APPROVE_ELIGIBLE"
    assert r.value >= 730
    assert r.reasons[0].kind == "why"
    assert any("24 of 24" in x.text for x in r.reasons)
    assert r.model_version == "rules-v1"


def test_every_point_is_explained() -> None:
    r = score(req(momo_inflows=[900_000, 1_000_000, 1_100_000]))
    unclamped = 600 + sum(x.points for x in r.reasons)
    assert r.value == max(SCORE_MIN, min(SCORE_MAX, unclamped))


def test_first_loan_is_reviewed_not_declined() -> None:
    r = score(req(history={"instalments_paid": 0, "paid_late": 0, "overdue_now": 0, "months_as_customer": 0}, affordability={"stated_income": 600_000, "new_instalment": 150_000}))
    assert r.recommendation == "REVIEW"
    assert r.headline == "Review · thin credit file"


def test_income_mismatch_is_flagged() -> None:
    # APP-20914 in the designs: stated revenue 2.4× MoMo inflows.
    r = score(req(affordability={"stated_income": 2_400_000, "new_instalment": 300_000}, momo_inflows=[1_000_000] * 6))
    assert r.recommendation == "FLAG"
    assert r.headline == "Flag · income mismatch"
    assert any("2.4× MoMo inflows" in x.text for x in r.reasons)


def test_unaffordable_loan_loses_points_and_is_reviewed() -> None:
    r = score(req(affordability={"monthly_income": 1_000_000, "new_instalment": 480_000}))
    assert r.recommendation in {"REVIEW", "FLAG"}
    assert any("above the 35% limit" in x.text for x in r.reasons)


def test_overdue_now_is_flagged() -> None:
    r = score(req(history={"instalments_paid": 10, "paid_late": 3, "overdue_now": 2, "months_as_customer": 12}))
    assert r.recommendation == "FLAG"


def test_score_stays_in_range() -> None:
    worst = score(req(history={"instalments_paid": 30, "paid_late": 30, "overdue_now": 9, "months_as_customer": 0}, affordability={"monthly_income": 100, "stated_income": 9_000_000, "new_instalment": 900_000}, momo_inflows=[5, 900_000, 1, 800_000]))
    best = score(req(history={"instalments_paid": 99, "paid_late": 0, "overdue_now": 0, "months_as_customer": 99}, affordability={"monthly_income": 10_000_000, "new_instalment": 1}, momo_inflows=[1_000_000] * 6))
    assert worst.value == SCORE_MIN
    assert best.value <= SCORE_MAX


def test_api_rejects_unknown_fields() -> None:
    body = req().model_dump()
    assert client.post("/v1/score", json=body).status_code == 200
    body["history"]["extra"] = 1
    assert client.post("/v1/score", json=body).status_code == 422


def test_early_warning_flags_falling_inflows_and_late_payers() -> None:
    out = early_warning(WarningRequest(loans=[
        WarningRequestItem(loan_id="a", momo_inflows=[1_000_000, 1_000_000, 1_000_000, 500_000], days_to_next_due=10),
        WarningRequestItem(loan_id="b", paid_late_last_cycle=True, partial_payments_last_90_days=2, days_to_next_due=5),
        WarningRequestItem(loan_id="c", momo_inflows=[1_000_000] * 4, days_to_next_due=10),
        WarningRequestItem(loan_id="d", paid_late_last_cycle=True, days_to_next_due=60),
    ]))
    by_id = {w.loan_id: w for w in out.flagged}
    assert set(by_id) == {"a", "b"}
    assert by_id["a"].signals == ["MoMo inflows down 50% this month"]
    assert by_id["b"].risk == "high"
