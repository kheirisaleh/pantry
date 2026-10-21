FROM python:3.12-slim AS assets
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm libcairo2 && apt-get clean
RUN pip install --no-cache-dir cairosvg pillow
WORKDIR /build
RUN npm init -y >/dev/null && npm install --no-audit --no-fund @iconify-json/fluent-emoji-flat @fontsource/bricolage-grotesque @fontsource/manrope @fontsource/vazirmatn chart.js@4
COPY app/icon_names.json app/icon_names.json
COPY app/static/logo.svg app/static/logo.svg
COPY tools/build_assets.py tools/build_assets.py
RUN python tools/build_assets.py node_modules app /out

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data BACKUP_DIR=/backups TZ=Europe/Berlin
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && apt-get clean
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ app/
COPY --from=assets /out/static/ app/static/
RUN mkdir -p /data /backups && chown 1000:1000 /data /backups && chmod -R a+rX /srv
USER 1000:1000
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
