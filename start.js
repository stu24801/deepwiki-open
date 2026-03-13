#!/usr/bin/env node
/**
 * DeepWiki Web 啟動腳本
 * 
 * Next.js standalone 模式本身不 serve /_next/static 和 /public
 * 這個腳本在 standalone server.js 前面加 static middleware 解決這個問題
 *
 * 用法: node start.js [port]  (預設 port 3002)
 */

const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || process.argv[2] || '3002', 10);
const ROOT = __dirname;
const STATIC_DIR = path.join(ROOT, '.next', 'standalone', '.next', 'static');
const PUBLIC_DIR = path.join(ROOT, '.next', 'standalone', 'public');

// 確認 standalone build 存在
const STANDALONE_SERVER = path.join(ROOT, '.next', 'standalone', 'server.js');
if (!fs.existsSync(STANDALONE_SERVER)) {
  console.error('❌ .next/standalone/server.js 不存在，請先執行 npm run build');
  process.exit(1);
}

// MIME 對應表
const MIME = {
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain',
  '.html': 'text/html',
  '.map':  'application/json',
};

function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    // 靜態資源可長期快取
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(data);
  });
}

// 建立 proxy 到 standalone server（跑在 PORT+1）
const STANDALONE_PORT = PORT + 1;
process.env.PORT = String(STANDALONE_PORT);
process.env.HOSTNAME = '127.0.0.1';

// 動態 require standalone server
require(STANDALONE_SERVER);

// 給 standalone server 時間啟動
setTimeout(() => {
  const proxy = http.createServer((req, res) => {
    const url = req.url || '/';

    // /_next/static/* → 直接從本機 static 目錄 serve
    if (url.startsWith('/_next/static/')) {
      const filePath = path.join(STATIC_DIR, url.replace('/_next/static/', ''));
      return serveStatic(req, res, filePath);
    }

    // /public/* (favicon 等) → 從 public 目錄 serve
    if (url.startsWith('/favicon') || url.startsWith('/icon') || url.startsWith('/apple-')) {
      const filePath = path.join(PUBLIC_DIR, url.split('?')[0]);
      if (fs.existsSync(filePath)) {
        return serveStatic(req, res, filePath);
      }
    }

    // 其他全部 proxy 到 standalone server
    const options = {
      hostname: '127.0.0.1',
      port: STANDALONE_PORT,
      path: url,
      method: req.method,
      headers: req.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (e) => {
      console.error('Proxy error:', e.message);
      res.writeHead(502);
      res.end('Bad Gateway');
    });

    req.pipe(proxyReq, { end: true });
  });

  proxy.on('upgrade', (req, socket, head) => {
    // WebSocket upgrade proxy（雖然 WebSocket 走後端 8001，這裡保險起見也支援）
    const net = require('net');
    const conn = net.connect(STANDALONE_PORT, '127.0.0.1', () => {
      conn.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
      const headers = req.rawHeaders;
      for (let i = 0; i < headers.length; i += 2) {
        conn.write(`${headers[i]}: ${headers[i+1]}\r\n`);
      }
      conn.write('\r\n');
      conn.write(head);
      socket.pipe(conn);
      conn.pipe(socket);
    });
    conn.on('error', () => socket.destroy());
  });

  proxy.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ DeepWiki Web running on port ${PORT}`);
    console.log(`  Static: ${STATIC_DIR}`);
    console.log(`  Standalone: port ${STANDALONE_PORT}`);
  });
}, 3000);
