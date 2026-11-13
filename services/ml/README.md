# Kora Lend ML service

Transparent, rules-based scoring (`app/scoring.py`) behind a small FastAPI app. The API calls it at `ML_URL` (default `http://localhost:8000`).

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn app.main:app --port 8000      # run
.venv/bin/pytest && .venv/bin/ruff check .      # test
```

Every answer carries reasons with their points and a `model_version`. Recommendations never include "decline"; a person decides. `tests/test_fairness.py` checks that gender, region and other protected characteristics cannot be inputs, and that groups with the same finances get the same outcomes. Run the same checks on any trained model before it replaces the rules.
