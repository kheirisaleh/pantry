#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
PORT=8097

if command -v ss > /dev/null && ss -tln | awk '{print $4}' | grep -qE "[:.]${PORT}\$"; then
  if ! docker ps --format '{{.Names}}' | grep -qx pantry; then
    echo "Port ${PORT} is already used by something else. Change it in docker-compose.yml first."
    exit 1
  fi
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add GEMINI_API_KEY there to switch on the assistant."
fi

mkdir -p data backups
for folder in data backups; do
  if [ "$(stat -c %u "$folder")" != "1000" ]; then
    if [ "$(id -u)" = "0" ]; then
      chown -R 1000:1000 "$folder"
    else
      echo "The container runs as user 1000 and cannot write to ./$folder. Run: sudo chown -R 1000:1000 $folder"
      exit 1
    fi
  fi
done

docker compose up -d --build

for attempt in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:${PORT}/healthz" > /dev/null; then
    echo "Pantry is running on port ${PORT}."
    exit 0
  fi
  sleep 2
done

echo "The container did not answer in time. Check: docker logs pantry"
exit 1
