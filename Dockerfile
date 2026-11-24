# syntax=docker/dockerfile:1

# ---- 1. SPA build (real API, same origin) ----
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_MODE=live
RUN npm run build

# ---- 2. ONNX models: export toxicity (needs torch), download emotion. Only /app/models is kept ----
FROM python:3.13-slim AS models
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_SYSTEM_PYTHON=1 UV_LINK_MODE=copy HF_HOME=/tmp/hf PIP_NO_CACHE_DIR=1
# CPU-only torch from the PyTorch CPU index (the default PyPI wheel drags in ~2 GB of CUDA libraries),
# then the rest of the `export` extra (see pyproject.toml).
RUN uv pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && uv pip install "huggingface_hub>=0.23" "optimum[onnxruntime]>=1.21"
COPY scripts/fetch_models.py scripts/fetch_models.py
RUN mkdir models && python scripts/fetch_models.py --export \
 && test -s models/emotion/model.onnx && test -s models/toxicity/model.onnx

# ---- 3. Runtime: no torch, no node ----
FROM python:3.13-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
# sqlcipher3-wheels ships SQLCipher inside a manylinux wheel, so no extra apt libraries are needed.
# util-linux (setpriv) is already in the base image; it drops root after fixing the volume's ownership.
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY scripts/create_invite.py ./scripts/create_invite.py
COPY --from=models /app/models ./models
COPY --from=frontend /build/dist ./frontend/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN useradd --system --uid 10001 --home-dir /app app \
 && mkdir -p /data && chown app:app /data \
 && chmod +x /usr/local/bin/docker-entrypoint.sh
# /app/src is on PYTHONPATH (the project itself is not installed), so the app finds ./models and its scale defs.
ENV PATH=/app/.venv/bin:$PATH PYTHONPATH=/app/src PYTHONUNBUFFERED=1 \
    DATA_DIR=/data FRONTEND_DIST=/app/frontend/dist MODELS_DIR=/app/models PORT=8000
EXPOSE 8000
ENTRYPOINT ["docker-entrypoint.sh"]
# One worker: rate limits, OAuth state and the event bus are per process.
CMD ["sh", "-c", "exec uvicorn analyzer.web.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --no-proxy-headers --no-access-log"]
