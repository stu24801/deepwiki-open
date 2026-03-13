# DeepWiki 本機部署指南（Alex 的 GCP VM 環境）

> 這份文件記錄了在 GCP VM 上以非 Docker 方式部署 DeepWiki 的正確做法與踩坑紀錄。
> 後人維護請先看這份，省去重新踩坑的時間。

---

## 環境概覽

- **主機**：GCP VM（Ubuntu），雙核 Intel Xeon 2.20GHz，16GB RAM
- **對外存取**：透過 Cloudflare Tunnel，不需開放防火牆
- **網址**：`https://deepwiki.alex-stu24801.com`
- **Python**：3.12，uvicorn 在 `~/.local/bin/uvicorn`
- **Node.js**：v22

---

## 環境變數（`.env`）

```env
# LLM Proxy（本機 port 9000，走 GitHub Copilot 憑證）
LLM_PROXY_TOKEN=<proxy token>        # 讓 OpenAI SDK 不報錯，實際認證在 proxy 那邊
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

---

## 架構圖

```
[使用者瀏覽器]
     │ HTTPS
     ▼
[Cloudflare Tunnel]
  ├── /ws/* ──────────────→ [FastAPI :8001]  ← WebSocket (wiki 生成、問答)
  └── 其他 ───────────────→ [start.js :3002]
                               ├── /_next/static/* → 本機 static 目錄（直接 serve）
                               └── 其他 → [Next.js standalone :3003]
                                             │ HTTP rewrite
                                             ▼
                                         [FastAPI :8001]
                                             │ OpenAI SDK → LLM Proxy :9000
```

---

## 啟動與重啟（唯一正確方式）

```bash
cd /path/to/deepwiki-open

# 全部重啟（最常用）
bash restart.sh all

# 只重啟後端
bash restart.sh api

# 只重啟前端
bash restart.sh web
```

腳本會自動：砍掉所有殘留行程 → 啟動 → 驗證 health check + static chunk 200。

### ⚠️ 不要用的方式

```bash
# ❌ 這個不 serve /_next/static，頁面會 Loading 卡死
node .next/standalone/server.js

# ❌ 這個在 standalone 模式下 cwd 會切換，static 路徑錯誤
node_modules/.bin/next start -p 3002
```

**為什麼要用 `start.js`：** Next.js standalone 模式不 serve `/_next/static`（官方設計如此，假設外面有 nginx）。`start.js` 是一個薄薄的 proxy layer，負責把 `/_next/static/*` 直接從磁碟回應，其他請求 proxy 到 standalone server。

---

## Build 流程

```bash
cd /path/to/deepwiki-open
npm run build
bash restart.sh all
```

`restart.sh` 會自動把 `.next/static` 複製到 `.next/standalone/.next/static`。

---

## Cloudflare Tunnel（`~/.cloudflared/config.yml`）

```yaml
tunnel: 023298cf-f8b3-45cf-bfb2-b14cdef8f054
credentials-file: ~/.cloudflared/023298cf-...json

ingress:
  - hostname: deepwiki.alex-stu24801.com
    path: /ws/           # ← 必須在前，WebSocket 直達後端
    service: http://localhost:8001
  - hostname: deepwiki.alex-stu24801.com
    service: http://localhost:3002   # 其他走前端
  - service: http_status:404
```

**`/ws/` 路由一定要在前面**，否則 WebSocket upgrade 被前端攔截，wiki 生成會 504。

---

## Log 位置

| 服務 | Log 檔 |
|------|--------|
| 後端 API | `/tmp/deepwiki-api.log` |
| 前端 Web | `/tmp/deepwiki-web.log` |

---

## 常見問題快速排查

| 症狀 | 原因 | 解法 |
|------|------|------|
| 頁面一直 Loading | `/_next/static` 404，或跑的是舊版行程 | `bash restart.sh web` |
| Application error（client-side） | 靜態資源版本不一致（舊行程佔著 port）| `bash restart.sh web` |
| `EADDRINUSE: port 3002` | 殘留行程（含 systemd 啟動的）沒死透 | `bash restart.sh` 自動處理 |
| wiki 生成 504 | WebSocket 連到 localhost:8001（舊 bug，已修） | 確認程式碼最新版 |
| 右下角提問 Unauthorized | auth_code 沒帶進 WebSocket 請求（舊 bug，已修） | 確認程式碼最新版 |
| 介面顯示英文不顯示繁中 | localStorage 有舊 language 設定 | 清 localStorage 的 `language` key |
| model 名稱出現破折號（`claude-sonnet-4-6`）| localStorage 的 `deepwiki_repo_configs` 有舊值 | 清 localStorage 或重新選擇 model |

---

## 密碼

DeepWiki 網站密碼：`qA!`（`DEEPWIKI_AUTH_CODE`）

---

*最後更新：2026-03-13，工程蝦*
