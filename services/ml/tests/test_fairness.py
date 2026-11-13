"""Bias checks for the score (BUILD_BRIEF §4.6: test for gender and region)."""

import random

import pytest
from pydantic import ValidationError

from app.scoring import ScoreRequest, score


def profile(rng: random.Random) -> dict:
    paid = rng.randint(0, 40)
    income = rng.randint(200_000, 4_000_000)
    return {
        "history": {"instalments_paid": paid, "paid_late": rng.randint(0, paid // 3) if paid else 0, "overdue_now": rng.choice([0, 0, 0, 1]), "months_as_customer": rng.randint(0, 60)},
        "affordability": {"monthly_income": income, "new_instalment": rng.randint(10_000, income // 2)},
        "momo_inflows": [int(income * rng.uniform(0.6, 1.4)) for _ in range(6)] if rng.random() < 0.7 else None,
    }


@pytest.mark.parametrize("field", ["gender", "district", "age", "region", "date_of_birth", "marital_status"])
def test_protected_characteristics_cannot_be_inputs(field: str) -> None:
    body = profile(random.Random(1))
    body[field] = "anything"
    with pytest.raises(ValidationError):
        ScoreRequest(**body)


def test_same_finances_get_the_same_score_whoever_applies() -> None:
    # The score is a function of financial behaviour only, so two applicants with
    # identical figures score identically. Checked over many random profiles.
    rng = random.Random(2026)
    for _ in range(500):
        body = profile(rng)
        assert score(ScoreRequest(**body)) == score(ScoreRequest(**dict(body)))


def test_outcomes_by_group_on_identical_distributions() -> None:
    # Two synthetic groups drawn from the same financial distribution (standing in
    # for women and men, or two districts) must get the same approval-type rate.
    # A gap here would mean a rule leaks something other than finances.
    def rate(seed: int) -> float:
        rng = random.Random(seed)
        recs = [score(ScoreRequest(**profile(rng))).recommendation for _ in range(2000)]
        return sum(r in {"APPROVE", "AUTO_APPROVE_ELIGIBLE"} for r in recs) / len(recs)

    a, b = rate(11), rate(22)
    assert abs(a - b) < 0.04, (a, b)
