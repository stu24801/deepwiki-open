#!/bin/bash
# restart.sh - DeepWiki 重啟腳本
# 用法: bash restart.sh [all|api|web]

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

stop_port() {
  local port=$1
  local pid
  pid=$(ss -tlnp | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | head -1)
  if [ -n "$pid" ]; then
    echo "Killing PID $pid on port $port..."
    kill -9 "$pid"
    sleep 1
  fi
}

start_api() {
  echo "Starting API (port 8001)..."
  stop_port 8001
  nohup env $(grep -v '^#' .env | grep '=' | xargs) PYTHONPATH=. \
    ~/.local/bin/uvicorn api.api:app --host 127.0.0.1 --port 8001 \
    > /tmp/deepwiki-api-debug.log 2>&1 &
  sleep 3
  curl -sf http://127.0.0.1:8001/health > /dev/null && echo "✓ API OK" || echo "✗ API FAILED"
}

start_web() {
  echo "Starting Web (port 3002)..."
  stop_port 3002
  nohup node_modules/.bin/next start -p 3002 > /tmp/deepwiki-web.log 2>&1 &
  sleep 6
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3002/)
  local chunk_url
  chunk_url=$(curl -s http://127.0.0.1:3002/ | grep -o '/_next/static/chunks/vendors[^"]*\.js' | head -1)
  local chunk_code
  chunk_code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3002${chunk_url}")
  echo "✓ Web OK (page=$http_code, chunk=$chunk_code)"
  if [ "$chunk_code" != "200" ]; then
    echo "⚠️  Static chunk 404 - wrong process might be serving. Check with: ss -tlnp | grep 3002"
  fi
}

TARGET="${1:-all}"

case "$TARGET" in
  api)  start_api ;;
  web)  start_web ;;
  all)  start_api; start_web ;;
  *)    echo "Usage: bash restart.sh [all|api|web]"; exit 1 ;;
esac

echo "Done."
