FROM python:3.15.1-slim@sha256:5b5ca730846f66dc816dbac397fcc0ec002230ec3aee6e09d2c44f8eafeddda2

ARG PIP_VERSION=26.2.2
ARG UV_VERSION=0.13.5

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/app \
    UV_NO_CACHE=1

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

RUN python -m pip install --no-cache-dir --upgrade "pip==$PIP_VERSION" && \
    python -m pip install --no-cache-dir "uv==$UV_VERSION"

COPY --chown=app:app pyproject.toml uv.lock manage.py ./
RUN uv export --locked --format requirements-txt --no-emit-project --no-dev \
        --output-file /tmp/requirements.lock && \
    uv pip install --system --require-hashes -r /tmp/requirements.lock

COPY --chown=app:app api ./api
COPY --chown=app:app classification ./classification
COPY --chown=app:app feedback ./feedback
COPY --chown=app:app billing ./billing
COPY --chown=app:app families ./families
COPY --chown=app:app store ./store
COPY --chown=app:app brainrot_index_service ./brainrot_index_service
RUN uv pip install --system --no-deps .

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}

COPY entrypoint.sh /app/entrypoint.sh
RUN mkdir -p /app/staticfiles /app/media && \
    chmod +x /app/entrypoint.sh && \
    chown app:app /app /app/staticfiles /app/media

USER app

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
