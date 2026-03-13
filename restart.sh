#!/bin/bash
# restart.sh - DeepWiki 可靠重啟腳本
# 用法: bash restart.sh [all|api|web]
# 作者: 工程蝦 2026-03-13

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="${1:-all}"

# ────────────────────────────────────────────
# 工具函式
# ────────────────────────────────────────────

stop_port() {
  local port=$1
  local pid
  # 用 ss 找所有佔用這個 port 的 PID（可能有多個殘留）
  for pid in $(ss -tlnp | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | sort -u); do
    echo "  殺掉 PID $pid (port $port)..."
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
  if ss -tlnp | grep -q ":${port} "; then
    echo "  ⚠️  port $port 仍被佔用，強制等待..."
    sleep 2
  fi
}

# ────────────────────────────────────────────
# 啟動後端 (FastAPI port 8001)
# ────────────────────────────────────────────

start_api() {
  echo ""
  echo "▶ 啟動後端 API (port 8001)..."
  stop_port 8001

  if [ ! -f .env ]; then
    echo "  ❌ .env 不存在，請建立後再試"
    exit 1
  fi

  # 用 env 明確傳入變數，避免 nohup 繼承問題
  ENV_VARS=$(grep -v '^#' .env | grep '=' | xargs)

  nohup env $ENV_VARS PYTHONPATH=. \
    ~/.local/bin/uvicorn api.api:app --host 127.0.0.1 --port 8001 \
    > /tmp/deepwiki-api.log 2>&1 &

  echo "  等待啟動..."
  for i in $(seq 1 10); do
    sleep 1
    if curl -sf http://127.0.0.1:8001/health > /dev/null 2>&1; then
      echo "  ✓ API 正常 (port 8001)"
      return 0
    fi
  done
  echo "  ❌ API 啟動失敗，查看 /tmp/deepwiki-api.log"
  exit 1
}

# ────────────────────────────────────────────
# 啟動前端 (Next.js port 3002)
# ────────────────────────────────────────────

start_web() {
  echo ""
  echo "▶ 啟動前端 Web (port 3002)..."
  stop_port 3002
  stop_port 3003   # start.js 內部 standalone 用 PORT+1

  # 確認 build 完整
  if [ ! -f .next/standalone/server.js ]; then
    echo "  ❌ .next/standalone/server.js 不存在，先執行 npm run build"
    exit 1
  fi

  # 確認 static 資源已複製進 standalone
  if [ ! -d .next/standalone/.next/static ]; then
    echo "  複製 static 到 standalone..."
    cp -r .next/static .next/standalone/.next/static
  fi

  if [ ! -d .next/standalone/public ]; then
    echo "  複製 public 到 standalone..."
    cp -r public .next/standalone/public 2>/dev/null || true
  fi

  nohup node start.js 3002 > /tmp/deepwiki-web.log 2>&1 &

  echo "  等待啟動..."
  for i in $(seq 1 15); do
    sleep 1
    if curl -sf http://127.0.0.1:3002/ > /dev/null 2>&1; then
      break
    fi
  done

  # 驗證 static chunk 可以正常讀取
  CHUNK=$(curl -s http://127.0.0.1:3002/ | grep -o '/_next/static/chunks/vendors[^"]*\.js' | head -1)
  if [ -z "$CHUNK" ]; then
    echo "  ❌ 無法取得 chunk URL，查看 /tmp/deepwiki-web.log"
    exit 1
  fi

  CHUNK_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3002${CHUNK}")
  if [ "$CHUNK_CODE" = "200" ]; then
    echo "  ✓ Web 正常 (port 3002，static chunk $CHUNK_CODE)"
  else
    echo "  ❌ Static chunk 回傳 $CHUNK_CODE，查看 /tmp/deepwiki-web.log"
    exit 1
  fi
}

# ────────────────────────────────────────────
# 執行
# ────────────────────────────────────────────

echo "=============================="
echo " DeepWiki 重啟 ($TARGET)"
echo "=============================="

case "$TARGET" in
  api)  start_api ;;
  web)  start_web ;;
  all)  start_api && start_web ;;
  *)    echo "用法: bash restart.sh [all|api|web]"; exit 1 ;;
esac

echo ""
echo "=============================="
echo " 完成！"
echo " API log: /tmp/deepwiki-api.log"
echo " Web log: /tmp/deepwiki-web.log"
echo "=============================="
