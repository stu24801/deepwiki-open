# DeepWiki 本機部署指南（Alex 的 GCP VM 環境）

> 這份文件記錄了在 GCP VM 上以非 Docker 方式部署 DeepWiki 的實際踩坑與正確做法。
> 後人維護請先看這份，省去重新踩坑的時間。

---

## 環境概覽

- **主機**：GCP VM（Ubuntu），雙核 Intel Xeon 2.20GHz，16GB RAM
- **對外存取**：透過 Cloudflare Tunnel，不需開放防火牆
- **網址**：`https://deepwiki.alex-stu24801.com`
- **Python**：3.12，uvicorn 在 `~/.local/bin/uvicorn`
- **Node.js**：v22

---

## 目錄結構

```
deepwiki-open/
├── api/               # FastAPI 後端
├── src/               # Next.js 前端原始碼
├── .next/             # Build 輸出（勿直接修改）
├── .env               # 環境變數（不進 git）
└── DEPLOYMENT.md      # 本文件
```

---

## 環境變數（`.env`）

```env
# LLM Proxy（本機 port 9000，走 GitHub Copilot 憑證）
LLM_PROXY_TOKEN=<proxy token>        # 只是讓 OpenAI SDK 不報錯，實際不驗
OPENAI_BASE_URL=http://127.0.0.1:9000/v1

# Google AI（用於 Embedding）
GOOGLE_API_KEY=<google api key>
DEEPWIKI_EMBEDDER_TYPE=google

# 密碼保護
DEEPWIKI_AUTH_MODE=true
DEEPWIKI_AUTH_CODE=qA!

# Server
PORT=8001
SERVER_BASE_URL=http://localhost:8001
```

**注意：** `LLM_PROXY_TOKEN` 不是真正的 OpenAI Key，是本機 proxy 的 token。
所有 LLM 請求走 `OPENAI_BASE_URL`（port 9000 proxy），不直連 OpenAI。

---

## 啟動方式

### 後端（FastAPI）

```bash
cd /path/to/deepwiki-open
source .env          # 載入環境變數
export PYTHONPATH=.

# 重要：一定要用 env 明確傳入環境變數，nohup 不會繼承 source 的變數
nohup env $(cat .env | grep -v '^#' | xargs) PYTHONPATH=. \
  uvicorn api.api:app --host 127.0.0.1 --port 8001 \
  > /tmp/deepwiki-api.log 2>&1 &
```

確認健康：
```bash
curl http://127.0.0.1:8001/health
# → {"status":"healthy",...}
```

### 前端（Next.js）

⚠️ **重要：一定要用 `next start`，不可以直接跑 `standalone/server.js`**

```bash
cd /path/to/deepwiki-open

# 正確方式
nohup node_modules/.bin/next start -p 3002 > /tmp/deepwiki-web.log 2>&1 &
```

❌ **錯誤方式（不要用）：**
```bash
# 這種方式不會 serve /_next/static，頁面會一直 Loading
node .next/standalone/server.js
```

**原因：** Next.js standalone 模式的靜態資源（JS/CSS chunks）需要由 `next start` 或 nginx 來 serve。
直接跑 `standalone/server.js` 不會 serve `/_next/static`，每次 build hash 變了
瀏覽器抓新 chunk 就 404，頁面噴 `Application error: client-side exception`。

---

## Build 後必做

每次 `npm run build` 完之後，**必須執行**：

```bash
# 把 static 資源複製進 standalone（雖然 next start 不需要，但備用）
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
```

---

## 重啟流程

```bash
# 1. 砍掉舊行程
kill -9 $(ss -tlnp | grep 8001 | awk '{print $6}' | grep -oP 'pid=\K[0-9]+') 2>/dev/null
kill -9 $(ss -tlnp | grep 3002 | awk '{print $6}' | grep -oP 'pid=\K[0-9]+') 2>/dev/null

# 2. 啟動後端
cd /path/to/deepwiki-open
nohup env $(cat .env | grep -v '^#' | xargs) PYTHONPATH=. \
  ~/.local/bin/uvicorn api.api:app --host 127.0.0.1 --port 8001 \
  > /tmp/deepwiki-api.log 2>&1 &

# 3. 啟動前端
nohup node_modules/.bin/next start -p 3002 > /tmp/deepwiki-web.log 2>&1 &

# 4. 確認
sleep 5
curl http://127.0.0.1:8001/health
curl -o /dev/null -w "%{http_code}" http://127.0.0.1:3002/
```

---

## Cloudflare Tunnel（`~/.cloudflared/config.yml`）

```yaml
tunnel: 023298cf-f8b3-45cf-bfb2-b14cdef8f054
credentials-file: ~/.cloudflared/023298cf-...json

ingress:
  - hostname: deepwiki.alex-stu24801.com
    path: /ws/           # WebSocket 直接走後端
    service: http://localhost:8001
  - hostname: deepwiki.alex-stu24801.com
    service: http://localhost:3002   # 其他走前端
  - hostname: alex-stu24801.com
    service: http://localhost:8081
  - service: http_status:404
```

**注意：** `/ws/` 路由必須在前端路由之前，讓 WebSocket 連線直接打到後端（port 8001），
否則前端攔截 WebSocket upgrade 請求會失敗，wiki 生成會 fallback 到 HTTP 然後 504。

---

## 常見問題

### Q: 網頁一直 Loading，沒有登入介面
**A:** 通常是 `/_next/static` 404。JS chunk 抓不到，React 無法初始化。
解法：確認用 `next start` 啟動，不要用 `standalone/server.js`。

### Q: 生成 wiki 時出現 504
**A:** Cloudflare 超時。原因是 WebSocket 連線失敗 fallback 到 HTTP，LLM 生成時間超過限制。
解法：確認 Cloudflare Tunnel config 的 `/ws/` routing 設定正確。

### Q: 右下角提問功能 `WebSocket connection failed`
**A:** `websocketClient.ts` 裡的 WebSocket URL 設定問題（已修復，用 `window.location.host`）。
若重現，確認 `src/utils/websocketClient.ts` 的 `getWebSocketUrl()` 是否用 `window.location`。

### Q: 出現 `Error with Openai API: An error occurred during streaming`
**A:** 瀏覽器 localStorage 存了舊的 model 名稱（`claude-sonnet-4-6` 破折號格式）。
解法：清掉 localStorage 的 `deepwiki_repo_configs`，或重新整理後重新選擇 model。
（已在 `page.tsx` 加入自動 normalize：`claude-xxx-4-6` → `claude-xxx-4.6`）

### Q: 密碼是什麼？
**A:** `qA!`（設定在 `.env` 的 `DEEPWIKI_AUTH_CODE`）

---

## LLM 架構說明

```
瀏覽器 → Cloudflare Tunnel → Next.js (3002)
                                  ↓ WebSocket /ws/chat
                              FastAPI (8001)
                                  ↓ OpenAI SDK (OPENAI_BASE_URL)
                              LLM Proxy (9000)  ← GitHub Copilot token
                                  ↓
                              Anthropic / GitHub Copilot API
```

**`LLM_PROXY_TOKEN` 只是用來滿足 OpenAI SDK 初始化的非空要求，不是真正的 OpenAI Key。**
真正的認證在 LLM Proxy（port 9000）那邊用 GitHub Copilot token 處理。

---

*最後更新：2026-03-13，工程蝦*
