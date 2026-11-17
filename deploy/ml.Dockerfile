# Kora Lend scoring service (FastAPI). Build context: the repository root.
FROM python:3.12-slim
WORKDIR /app
COPY services/ml/app app
# The service's dependencies, as listed in services/ml/pyproject.toml.
RUN pip install --no-cache-dir "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9"
EXPOSE 8000
# "::" listens on IPv6 too, which Railway's private network uses.
CMD ["sh", "-c", "uvicorn app.main:app --host :: --port ${PORT:-8000}"]
