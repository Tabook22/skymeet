FROM python:3.14-slim@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home skymeet && mkdir /data && chown skymeet /data
COPY backend/ .
COPY scripts/backup.py /app/backup.py
USER skymeet
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log --forwarded-allow-ips=127.0.0.1"]
