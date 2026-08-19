FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 依存だけ先にインストールしてレイヤキャッシュを効かせる
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]" || pip install --no-cache-dir \
    "fastapi>=0.115" "uvicorn[standard]>=0.30" "sqlalchemy>=2.0" "psycopg[binary]>=3.2" \
    "alembic>=1.13" "redis>=5.0" "argon2-cffi>=23.1" "pydantic-settings>=2.4" \
    "minio>=7.2" "python-multipart>=0.0.9" \
    "pytest>=8.3" "httpx>=0.27"

COPY . .
RUN pip install --no-cache-dir -e ".[dev]"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
