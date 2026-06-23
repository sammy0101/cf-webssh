# Complete Project Codebase
Generated on: Tue Jun 23 18:39:24 UTC 2026

## File: README.md
````md
# cf-webssh

一個基於 Cloudflare Workers (`workerd`) 平台構建的輕量級 WebSSH 工具。

本專案利用 Cloudflare 原生 TCP 接口（透過相容性標誌 `nodejs_compat` 啟用 `cloudflare:sockets`）與遠端主機建立安全的 SSH 通道，並在瀏覽器前端使用 `xterm.js` 提供高度互動性的終端體驗。

## 🎯 專案特點

- **無伺服器架構**：完全依賴 Cloudflare Workers 邊緣網路，無需部署與維護傳統的 WebSSH 後端伺服器（如 Bastion、Guacamole 等）。
- **可選的管理密碼保護（新增）**：
  - 支援設置環境變數 `ADMIN_PASSWORD` 作為管理員登入密碼。
  - **向下相容**：若未配置該變數，系統會自動切換為免密碼模式（不顯示登入頁面），行為與原版本一致。
  - **安全 Session 保護**：採用具有 `HttpOnly`、`Secure`、`SameSite=Strict` 屬性的安全 Cookie，能同時且安全地為 API 接口與 WebSocket 握手進行無狀態認證保護。
  - **完整登出機制**：前端支援一鍵登出清除 Session。
- **多伺服器配置管理**：支援記錄與維護多台伺服器的連線。所有主機資訊（不含密碼/私鑰）與敏感認證憑據（密碼、SSH 私鑰）皆安全地儲存於您個人的 Cloudflare KV 命名空間中。
- **安全編輯與局部更新**：提供完整的「新增、刪除、編輯」功能。前端卡片支援一鍵編輯，且後端 `POST` API 具備局部合併機制，若您在編輯伺服器時未重新填寫密碼或私鑰，系統會自動保留原先在 KV 中的敏感認證資訊，避免遺失。
- **優化的 xterm.js 終端**：
  - **自動聚焦 (Auto Focus)**：連線載入完成後自動鎖定焦點，無需手動用滑鼠點擊即可直接開始打字輸入。
  - **視窗尺寸動態同步**：支援瀏覽器視窗縮放時，自動向遠端虛擬終端（Pseudo-terminal, PTY）發送 `resize` 訊號。
  - **初次連線尺寸修正**：引入 `pendingResize` 機制，確保在 SSH 串流未就緒前發送的視窗初始化大小，能在連線建立的第一時間被套用。
- **Cloudflare Workers 專屬相容性適配**：
  - 針對 Workers 執行環境底層 BoringSSL 在計算 **X25519 DH 共享金鑰** 時的限制，主動排除 `curve25519` 相關的金鑰交換演算法（KEX），改用 NIST 標準曲線（如 `ecdh-sha2-nistp256`）或有限域 Diffie-Hellman 演算法進行握手。
  - 針對 Workers 的 `node:crypto` 串流解密不完整支援 AEAD 模式（如 `chacha20-poly1305`、`aes-gcm`）而會拋出 `No auth tag provided` 的限制，主動在握手階段限制僅協商使用 **CTR 計數器模式** 與 **CBC 模式**（如 `aes256-ctr`），配合獨立的 HMAC 校驗（如 `hmac-sha2-256`），確保資料傳輸穩定不中斷。

## ⚙️ 系統需求

- [Cloudflare 帳戶](https://dash.cloudflare.com/)
- [Node.js](https://nodejs.org/) (建議使用 v18.0.0 以上之版本)

## 🚀 部署指南

### 方法 A：透過 GitHub Actions 自動部署（推薦）

本專案已內建完整的 CI/CD 自動化工作流。當您將專案推送到 GitHub 的 `main` 分支時，系統將會**全自動處理 KV 命名空間**：

1. 將本專案上傳至您的 GitHub 私人儲存庫（Repository）。
2. 在 GitHub 專案的 `Settings -> Secrets and variables -> Actions` 中，新增一個名為 `CLOUDFLARE_API_TOKEN` 的 Secret（此 Token 需具備編輯 Workers 與 KV 命名空間的權限）。
3. 將代碼推送至 `main` 分支。
4. GitHub Actions 工作流（`.github/workflows/deploy.yml`）會自動偵測您的 Cloudflare 帳戶中是否已存在 `WEBSSH_KV` 命名空間。若不存在，將自動為您建立，並**自動動態填入** `wrangler.toml` 中的 `KV_NAMESPACE_ID_PLACEHOLDER`，最後完成編譯與部署。您無需進行任何手動文件修改。

> 💡 **如何在使用 GitHub Actions 部署時設置登入密碼？**
> 請直接登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)，進入您的 Workers 項目，點選 `Settings` -> `Variables` -> `Environment Variables`，手動新增變數 `ADMIN_PASSWORD`。為了安全性，請將其儲存類型設為 **Encrypt (Secret)**。

---

### 方法 B：從本機手動部署

如果您不使用 GitHub Actions，而是選擇直接從本機進行手動部署：

1. **安裝專案依賴**
   ```bash
   npm install
   ```

2. **手動建立 KV 命名空間並配置 `wrangler.toml`**
   在本機終端機執行以下 Wrangler 指令來建立 KV 空間：
   ```bash
   npx wrangler kv namespace create WEBSSH_KV
   ```
   指令執行後會輸出一段類似下方的配置：
   ```toml
   [[kv_namespaces]]
   binding = "WEBSSH_KV"
   id = "xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```
   請將此段配置手動複製並替換掉您專案根目錄下 `wrangler.toml` 檔案內原本的預留欄位。

3. **設定登入密碼（選填）**
   推薦直接使用安全命令建立加密密碼，避免將明文密碼寫入代碼：
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   ```
   *（根據提示輸入您的安全密碼即可，此操作會將密碼直接以加密 Secret 格式上傳至 Cloudflare 端）*

4. **打包編譯與部署**
   執行以下指令，系統會透過 `esbuild` 排除不相容的原生 binary 模組（並套用 `cpu-features` 模擬檔），隨後將程式碼發佈至 Cloudflare：
   ```bash
   npm run deploy
   ```

## 🔒 安全性建議

1. **啟用內建密碼**：強烈建議在生產環境中設定 `ADMIN_PASSWORD` 加密 Secret。
2. **Cloudflare Zero Trust / Cloudflare Access (雙重保障)**：
   對於極高安全要求的用戶，除了設定 `ADMIN_PASSWORD`，還可以在 Cloudflare Zero Trust 控制面板中為您部署此 Worker 的域名設定一條 Access 存取策略，限定僅允許您信任的電子郵件（如使用 Google/GitHub 登入認證）或特定 IP 網段才能存取本 WebSSH 頁面。

````

## File: src/index.js
````js
import { Client } from 'ssh2';
import htmlContent from '../public/index.html';

// 使用 WebCrypto 計算 SHA-256 雜湊值
async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 根據環境變數中的密碼加鹽計算預期 Token
async function getExpectedToken(adminPassword) {
  return await hashPassword(adminPassword + "cf-webssh-salt-2026");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 讀取環境變數中的管理密碼
    const adminPassword = env.ADMIN_PASSWORD;
    const isAuthEnabled = typeof adminPassword === 'string' && adminPassword.length > 0;

    // Cookie 讀取輔助函數
    const getCookie = (name) => {
      const value = `; ${request.headers.get('Cookie') || ''}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(';').shift();
      return null;
    };

    // 驗證當前連線是否已授權
    const isAuthorized = async () => {
      if (!isAuthEnabled) return true;
      const token = getCookie('webssh_token');
      if (!token) return false;
      const expected = await getExpectedToken(adminPassword);
      return token === expected;
    };

    // 安全防禦門禁：若啟用密碼驗證且未授權，阻擋所有非公開路徑（包含 SSH 與 SFTP WebSocket）
    const publicPaths = ['/', '/index.html', '/api/login', '/api/auth-check', '/api/logout'];
    if (!publicPaths.includes(url.pathname)) {
      if (!(await isAuthorized())) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    // 1. 靜態網頁派發
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 1.1 API: 檢查當前驗證狀態
    if (url.pathname === '/api/auth-check' && request.method === 'GET') {
      const authorized = await isAuthorized();
      return new Response(JSON.stringify({
        required: isAuthEnabled,
        authenticated: authorized
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1.2 API: 登入驗證
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try {
        const { password } = await request.json();
        if (isAuthEnabled && password === adminPassword) {
          const token = await getExpectedToken(adminPassword);
          // 設定 HttpOnly, Secure, SameSite=Strict 且 30 天內有效的 Cookie
          return new Response(JSON.stringify({ success: true }), {
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `webssh_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`
            }
          });
        }
        return new Response(JSON.stringify({ error: '密碼錯誤' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 1.3 API: 登出
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'webssh_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
        }
      });
    }

    // 2. API: 獲取已儲存的連線列表
    if (url.pathname === '/api/connections' && request.method === 'GET') {
      try {
        const list = await env.WEBSSH_KV.list({ prefix: 'connection:' });
        const keys = list.keys;
        const values = await Promise.all(keys.map(key => env.WEBSSH_KV.get(key.name)));
        const connections = [];

        for (const val of values) {
          if (val) {
            const data = JSON.parse(val);
            connections.push({
              id: data.id,
              name: data.name,
              host: data.host,
              port: data.port || 22,
              username: data.username,
              authType: data.privateKey ? 'key' : 'password',
            });
          }
        }
        return new Response(JSON.stringify(connections), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 3. API: 新增/更新連線資訊
    if (url.pathname === '/api/connections' && request.method === 'POST') {
      try {
        const data = await request.json();
        if (!data.name || !data.host || !data.username) {
          return new Response(JSON.stringify({ error: '缺少必要欄位' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const id = data.id || crypto.randomUUID();

        const existingVal = await env.WEBSSH_KV.get(`connection:${id}`);
        let existing = {};
        if (existingVal) {
          try {
            existing = JSON.parse(existingVal);
          } catch (_) {}
        }

        const connectionData = {
          id,
          name: data.name,
          host: data.host,
          port: parseInt(data.port) || 22,
          username: data.username,
          password: data.password !== undefined ? data.password : (existing.password || ''),
          privateKey: data.privateKey !== undefined ? data.privateKey : (existing.privateKey || ''),
        };
        
        await env.WEBSSH_KV.put(`connection:${id}`, JSON.stringify(connectionData));
        return new Response(JSON.stringify({ success: true, id }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 4. API: 刪除連線資訊
    if (url.pathname.startsWith('/api/connections/') && request.method === 'DELETE') {
      try {
        const id = url.pathname.split('/').pop();
        await env.WEBSSH_KV.delete(`connection:${id}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 5. WebSocket 協議轉換為 TCP SSH 終端橋接
    if (url.pathname.startsWith('/ssh/') && request.headers.get('Upgrade') === 'websocket') {
      const id = url.pathname.split('/').pop();
      const connectionVal = await env.WEBSSH_KV.get(`connection:${id}`);
      if (!connectionVal) {
        return new Response('連線配置不存在', { status: 404 });
      }

      const config = JSON.parse(connectionVal);
      const [client, server] = new WebSocketPair();

      server.accept();

      const sshClient = new Client();
      let sshStream = null;
      let pendingResize = null;

      sshClient.on('ready', () => {
        server.send('\r\n[SSH] 已連線，正在啟動終端...\r\n');
        
        const initialCols = pendingResize ? pendingResize.cols : 80;
        const initialRows = pendingResize ? pendingResize.rows : 24;

        sshClient.shell({ term: 'xterm-256color', cols: initialCols, rows: initialRows }, (err, stream) => {
          if (err) {
            server.send(`\r\n[SSH Shell 啟動失敗]: ${err.message}\r\n`);
            server.close(1011);
            sshClient.end();
            return;
          }
          sshStream = stream;
          server.send('\r\n[SSH] 終端已就緒\r\n');

          stream.on('data', (data) => {
            try {
              server.send(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            } catch (e) {
              server.send(String(data));
            }
          });

          if (stream.stderr) {
            stream.stderr.on('data', (data) => {
              try {
                server.send(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
              } catch (e) {
                server.send(String(data));
              }
            });
          }

          stream.on('close', () => {
            server.close();
            sshClient.end();
          });

          stream.on('error', (err) => {
            server.send(`\r\n[Stream Error]: ${err.message}\r\n`);
          });
        });
      });

      sshClient.on('error', (err) => {
        server.send(`\r\n[SSH 錯誤]: ${err.message}\r\n`);
        server.close(1011);
      });

      sshClient.on('close', () => {
        server.close();
      });

      sshClient.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
        finish([config.password || '']);
      });

      server.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'resize') {
            if (sshStream) {
              sshStream.setWindow(msg.rows, msg.cols);
            } else {
              pendingResize = { rows: msg.rows, cols: msg.cols };
            }
          } else if (msg.type === 'data' && sshStream) {
            sshStream.write(msg.data);
          }
        } catch (e) {
          if (sshStream) {
            sshStream.write(event.data);
          }
        }
      });

      server.addEventListener('close', () => {
        sshClient.end();
      });

      try {
        const connectOptions = {
          host: config.host,
          port: config.port || 22,
          username: config.username,
          readyTimeout: 30000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          tryKeyboard: true,
          algorithms: {
            kex: [
              'ecdh-sha2-nistp256',
              'ecdh-sha2-nistp384',
              'ecdh-sha2-nistp521',
              'diffie-hellman-group14-sha256',
              'diffie-hellman-group16-sha512',
              'diffie-hellman-group-exchange-sha256'
            ],
            cipher: [
              'aes128-ctr',
              'aes192-ctr',
              'aes256-ctr',
              'aes128-cbc',
              'aes192-cbc',
              'aes256-cbc'
            ]
          }
        };

        if (config.privateKey) {
          connectOptions.privateKey = config.privateKey;
        } else {
          connectOptions.password = config.password;
        }

        sshClient.connect(connectOptions);
      } catch (err) {
        server.send(`\r\n[SSH 初始化錯誤]: ${err.message}\r\n`);
        server.close(1011);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // 6. WebSocket 協議轉換為 TCP SFTP 檔案傳輸橋接 (新增)
    if (url.pathname.startsWith('/sftp/') && request.headers.get('Upgrade') === 'websocket') {
      const id = url.pathname.split('/').pop();
      const connectionVal = await env.WEBSSH_KV.get(`connection:${id}`);
      if (!connectionVal) {
        return new Response('連線配置不存在', { status: 404 });
      }

      const config = JSON.parse(connectionVal);
      const [client, server] = new WebSocketPair();

      server.accept();

      const sshClient = new Client();
      let sftpClient = null;
      let sftpStream = null;

      sshClient.on('ready', () => {
        sshClient.sftp((err, sftp) => {
          if (err) {
            server.send(JSON.stringify({ error: `SFTP 初始化失敗: ${err.message}` }));
            server.close(1011);
            sshClient.end();
            return;
          }
          sftpClient = sftp;
          // 通知前端 SFTP 連線就緒
          server.send(JSON.stringify({ status: 'ready' }));
        });
      });

      sshClient.on('error', (err) => {
        server.send(JSON.stringify({ error: `SSH 連線錯誤: ${err.message}` }));
        server.close(1011);
      });

      // 監聽傳輸封包
      server.addEventListener('message', async (event) => {
        // 如果接收到的是二進位 ArrayBuffer，代表檔案區塊 (Chunk) 資料
        if (event.data instanceof ArrayBuffer) {
          if (sftpStream) {
            const chunk = new Uint8Array(event.data);
            sftpStream.write(chunk, (err) => {
              if (err) {
                server.send(JSON.stringify({ error: `寫入遠端檔案失敗: ${err.message}` }));
                server.close(1011);
                return;
              }
              // 回傳寫入確認 (ack)，藉此控制傳輸背壓與精準計量進度
              server.send(JSON.stringify({ status: 'ack', written: chunk.length }));
            });
          } else {
            server.send(JSON.stringify({ error: '寫入串流尚未建立' }));
          }
          return;
        }

        // 處理 JSON 控制指令
        try {
          const msg = JSON.parse(event.data);
          if (msg.action === 'upload') {
            const remotePath = `./${msg.filename}`; // 上傳至該使用者的家目錄
            sftpStream = sftpClient.createWriteStream(remotePath, { flags: 'w', mode: 0o644 });
            
            sftpStream.on('error', (err) => {
              server.send(JSON.stringify({ error: `建立遠端寫入流失敗: ${err.message}` }));
              server.close(1011);
            });

            server.send(JSON.stringify({ status: 'start_ok' }));
          } else if (msg.action === 'end') {
            if (sftpStream) {
              sftpStream.end(() => {
                server.send(JSON.stringify({ status: 'success' }));
                server.close();
                sshClient.end();
              });
            } else {
              server.send(JSON.stringify({ status: 'success' }));
              server.close();
              sshClient.end();
            }
          }
        } catch (e) {
          server.send(JSON.stringify({ error: `命令解析錯誤: ${e.message}` }));
        }
      });

      server.addEventListener('close', () => {
        if (sftpStream) sftpStream.end();
        sshClient.end();
      });

      try {
        const connectOptions = {
          host: config.host,
          port: config.port || 22,
          username: config.username,
          readyTimeout: 30000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          tryKeyboard: true,
          algorithms: {
            kex: [
              'ecdh-sha2-nistp256',
              'ecdh-sha2-nistp384',
              'ecdh-sha2-nistp521',
              'diffie-hellman-group14-sha256',
              'diffie-hellman-group16-sha512',
              'diffie-hellman-group-exchange-sha256'
            ],
            cipher: [
              'aes128-ctr',
              'aes192-ctr',
              'aes256-ctr',
              'aes128-cbc',
              'aes192-cbc',
              'aes256-cbc'
            ]
          }
        };

        if (config.privateKey) {
          connectOptions.privateKey = config.privateKey;
        } else {
          connectOptions.password = config.password;
        }

        sshClient.connect(connectOptions);
      } catch (err) {
        server.send(JSON.stringify({ error: `SFTP 握手失敗: ${err.message}` }));
        server.close(1011);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

````

## File: wrangler.toml
````toml
name = "cf-webssh"
main = "dist/index.js"
compatibility_date = "2026-01-01"
compatibility_flags = [ "nodejs_compat" ]

[[kv_namespaces]]
binding = "WEBSSH_KV"
id = "KV_NAMESPACE_ID_PLACEHOLDER"

[vars]
# ==========================================
# 管理登入密碼（選填）
# ==========================================
# 若留空或註解此行，系統將不啟用登入頁面，任何人皆能讀取/連線您的伺服器。
#
# 建議生產環境保護：
# 本地測試時可於此處直接填寫明文密碼，
# 但發佈至生產環境時，強烈建議不要寫入此toml檔，
# 而是直接在網頁控制台設定「Secret」或使用命令：
# $ npx wrangler secret put ADMIN_PASSWORD
# ==========================================
# ADMIN_PASSWORD = "your_secure_password"

````

## File: public/index.html
````html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare WebSSH 工作台</title>
  
  <!-- 網站 Favicon (使用嵌入式 SVG 終端圖示) -->
  <link rel="icon" type="image/svg+xml" href='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="25" fill="%23020617" stroke="%2310b981" stroke-width="4"/><text x="18" y="70" font-family="monospace" font-size="62" font-weight="bold" fill="%2310b981">&gt;_</text></svg>'>

  <!-- CSS 依賴 -->
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css">
  <!-- JS 依賴 -->
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
</head>
<body class="bg-slate-950 text-slate-100 font-sans min-h-screen">

  <div id="app" class="container mx-auto p-6 max-w-6xl">
    <header class="mb-8 flex justify-between items-center border-b border-slate-800 pb-4">
      <!-- 主畫面標題，左側帶有微型 terminal 圖示 -->
      <h1 class="text-2xl font-bold tracking-wider text-emerald-400 flex items-center gap-2">
        <svg class="w-8 h-8 text-emerald-400" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="100" height="100" rx="25" fill="#020617" stroke="currentColor" stroke-width="6"/>
          <text x="18" y="70" font-family="monospace" font-size="62" font-weight="bold" fill="currentColor">&gt;_</text>
        </svg>
        <span>CF-WebSSH</span>
      </h1>
      <div class="flex space-x-3">
        <!-- 登出按鈕，僅在啟用密碼驗證且登入成功時顯示 -->
        <button id="logout-btn" onclick="handleLogout()" class="hidden bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded font-medium transition text-sm">
          登出
        </button>
        <button onclick="showAddModal()" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-medium transition text-sm">
          新增伺服器
        </button>
      </div>
    </header>

    <!-- 伺服器列表 -->
    <main>
      <div id="connections-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <!-- 動態渲染清單 -->
      </div>
      <div id="empty-state" class="hidden text-center py-20 text-slate-500">
        目前沒有儲存的伺服器，點擊右上角新增連線。
      </div>
    </main>
  </div>

  <!-- 登入全螢幕遮罩 -->
  <div id="login-overlay" class="fixed inset-0 bg-slate-950 flex hidden items-center justify-center p-4 z-50 animate-fade-in">
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-sm shadow-2xl text-center">
      <!-- 登入介面的中置大型 LOGO -->
      <div class="flex justify-center mb-4">
        <svg class="w-16 h-16 text-emerald-400" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="100" height="100" rx="25" fill="#020617" stroke="currentColor" stroke-width="6"/>
          <text x="18" y="70" font-family="monospace" font-size="62" font-weight="bold" fill="currentColor">&gt;_</text>
        </svg>
      </div>
      <h1 class="text-2xl font-bold tracking-wider text-emerald-400 mb-2">⚡ CF-WebSSH</h1>
      <p class="text-sm text-slate-400 mb-6">此工作台已受管理密碼保護，請輸入：</p>
      <form id="login-form" onsubmit="handleLogin(event)">
        <input type="password" id="login-password" required placeholder="請輸入密碼" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-center mb-4">
        <button type="submit" class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-medium transition">驗證並登入</button>
        <p id="login-error" class="text-xs text-rose-500 mt-3 hidden"></p>
      </form>
    </div>
  </div>

  <!-- 新增/編輯 Modal -->
  <div id="modal" class="fixed inset-0 bg-black/80 hidden items-center justify-center p-4 z-40">
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-lg shadow-2xl">
      <h2 id="modal-title" class="text-xl font-bold mb-4 text-emerald-400">連線設定</h2>
      <form id="connection-form" onsubmit="saveConnection(event)">
        <input type="hidden" id="conn-id">
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-slate-400 mb-1">名稱</label>
            <input type="text" id="conn-name" required placeholder="例如: 阿里雲 / 騰訊雲" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
          </div>
          <div class="grid grid-cols-3 gap-4">
            <div class="col-span-2">
              <label class="block text-sm text-slate-400 mb-1">主機 IP / 域名</label>
              <input type="text" id="conn-host" required placeholder="192.168.1.1" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
            </div>
            <div>
              <label class="block text-sm text-slate-400 mb-1">端口</label>
              <input type="number" id="conn-port" value="22" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
            </div>
          </div>
          <div>
            <label class="block text-sm text-slate-400 mb-1">使用者名稱</label>
            <input type="text" id="conn-username" required placeholder="root" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
          </div>
          <div>
            <label class="block text-sm text-slate-400 mb-1">驗證方式</label>
            <select id="conn-auth-type" onchange="toggleAuthType()" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
              <option value="password">密碼驗證</option>
              <option value="key">Ed25519 / RSA 私鑰驗證</option>
            </select>
          </div>
          <div id="password-field">
            <label class="block text-sm text-slate-400 mb-1">密碼</label>
            <input type="password" id="conn-password" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
          </div>
          <div id="key-field" class="hidden">
            <label class="block text-sm text-slate-400 mb-1">私鑰 (PEM 格式)</label>
            <textarea id="conn-privatekey" rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"></textarea>
          </div>
        </div>
        <div class="mt-6 flex justify-end space-x-3">
          <button type="button" onclick="hideModal()" class="px-4 py-2 border border-slate-800 rounded hover:bg-slate-800 transition">取消</button>
          <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-medium transition">儲存</button>
        </div>
      </form>
    </div>
  </div>

  <!-- 終端機全螢幕容器 -->
  <div id="terminal-screen" class="fixed inset-0 bg-black hidden flex-col z-50">
    <div class="bg-slate-900 px-4 py-2 flex justify-between items-center border-b border-slate-800 text-sm">
      <span id="active-terminal-title" class="font-mono text-slate-300">連線中...</span>
      <button onclick="closeTerminal()" class="bg-rose-700 hover:bg-rose-600 px-3 py-1 rounded text-white transition">
        中斷連線
      </button>
    </div>
    <div id="terminal-container" class="flex-1 p-2 bg-black"></div>
  </div>

  <script>
    let ws = null;
    let term = null;
    let fitAddon = null;

    // 啟動入口
    document.addEventListener("DOMContentLoaded", checkAuth);

    // 1. 檢查驗證狀態
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth-check');
        const auth = await res.json();
        
        if (auth.required) {
          if (auth.authenticated) {
            document.getElementById('logout-btn').classList.remove('hidden');
            fetchConnections();
          } else {
            showLoginOverlay();
          }
        } else {
          // 沒有啟用密碼驗證
          fetchConnections();
        }
      } catch (err) {
        console.error("驗證檢查失敗:", err);
      }
    }

    function showLoginOverlay() {
      document.getElementById('login-overlay').classList.remove('hidden');
      document.getElementById('login-password').focus();
    }

    // 2. 登入提交
    async function handleLogin(event) {
      event.preventDefault();
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');
      errorEl.classList.add('hidden');

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          document.getElementById('login-overlay').classList.add('hidden');
          document.getElementById('logout-btn').classList.remove('hidden');
          fetchConnections();
        } else {
          errorEl.textContent = data.error || '登入失敗';
          errorEl.classList.remove('hidden');
        }
      } catch (err) {
        errorEl.textContent = '連線錯誤，請稍後重試';
        errorEl.classList.remove('hidden');
      }
    }

    // 3. 登出
    async function handleLogout() {
      try {
        await fetch('/api/logout', { method: 'POST' });
        document.getElementById('logout-btn').classList.add('hidden');
        document.getElementById('login-password').value = '';
        showLoginOverlay();
      } catch (err) {
        console.error("登出失敗:", err);
      }
    }

    // 4. 取得伺服器列表
    async function fetchConnections() {
      try {
        const res = await fetch('/api/connections');
        if (res.status === 401) {
          showLoginOverlay();
          return;
        }
        const list = await res.json();
        const grid = document.getElementById('connections-grid');
        const empty = document.getElementById('empty-state');
        grid.innerHTML = '';

        if (list.length === 0) {
          empty.classList.remove('hidden');
          return;
        }
        empty.classList.add('hidden');

        list.forEach(conn => {
          const card = document.createElement('div');
          card.className = "bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col justify-between hover:border-slate-700 transition shadow-md";
          card.innerHTML = `
            <div>
              <h3 class="text-lg font-bold text-slate-100">${conn.name}</h3>
              <p class="text-sm text-slate-400 font-mono mt-1">${conn.username}@${conn.host}:${conn.port}</p>
            </div>
            <div class="mt-5 flex justify-end space-x-2">
              <button onclick="editConnection('${conn.id}', '${conn.name}', '${conn.host}', ${conn.port}, '${conn.username}', '${conn.authType}')" class="text-indigo-400 hover:text-indigo-300 px-3 py-1.5 text-sm transition">編輯</button>
              <button onclick="deleteConnection('${conn.id}')" class="text-rose-400 hover:text-rose-300 px-3 py-1.5 text-sm transition">刪除</button>
              <button onclick="connectSSH('${conn.id}', '${conn.name}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-sm font-medium transition">連線</button>
            </div>
          `;
          grid.appendChild(card);
        });
      } catch (err) {
        console.error("無法取得伺服器列表:", err);
      }
    }

    function showAddModal() {
      document.getElementById('connection-form').reset();
      document.getElementById('conn-id').value = '';
      document.getElementById('modal-title').textContent = '新增連線設定';
      document.getElementById('conn-password').placeholder = '';
      document.getElementById('conn-privatekey').placeholder = '-----BEGIN OPENSSH PRIVATE KEY-----';
      document.getElementById('modal').classList.remove('hidden');
      document.getElementById('modal').classList.add('flex');
      toggleAuthType();
    }

    function editConnection(id, name, host, port, username, authType) {
      document.getElementById('conn-id').value = id;
      document.getElementById('conn-name').value = name;
      document.getElementById('conn-host').value = host;
      document.getElementById('conn-port').value = port;
      document.getElementById('conn-username').value = username;
      document.getElementById('conn-auth-type').value = authType;
      
      document.getElementById('modal-title').textContent = '編輯連線設定';
      document.getElementById('conn-password').value = '';
      document.getElementById('conn-privatekey').value = '';
      document.getElementById('conn-password').placeholder = '留空表示不修改原設定';
      document.getElementById('conn-privatekey').placeholder = '留空表示不修改原設定';

      document.getElementById('modal').classList.remove('hidden');
      document.getElementById('modal').classList.add('flex');
      toggleAuthType();
    }

    function hideModal() {
      document.getElementById('modal').classList.add('hidden');
      document.getElementById('modal').classList.remove('flex');
    }

    function toggleAuthType() {
      const type = document.getElementById('conn-auth-type').value;
      if (type === 'password') {
        document.getElementById('password-field').classList.remove('hidden');
        document.getElementById('key-field').classList.add('hidden');
      } else {
        document.getElementById('password-field').classList.add('hidden');
        document.getElementById('key-field').classList.remove('hidden');
      }
    }

    async function saveConnection(event) {
      event.preventDefault();
      const id = document.getElementById('conn-id').value;
      const name = document.getElementById('conn-name').value;
      const host = document.getElementById('conn-host').value;
      const port = document.getElementById('conn-port').value;
      const username = document.getElementById('conn-username').value;
      const authType = document.getElementById('conn-auth-type').value;

      const body = { id, name, host, port, username };
      
      if (authType === 'password') {
        const passwordVal = document.getElementById('conn-password').value;
        if (passwordVal || !id) {
          body.password = passwordVal;
          body.privateKey = '';
        }
      } else {
        const privateKeyVal = document.getElementById('conn-privatekey').value;
        if (privateKeyVal || !id) {
          body.privateKey = privateKeyVal;
          body.password = '';
        }
      }

      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.status === 401) {
        hideModal();
        showLoginOverlay();
        return;
      }

      hideModal();
      fetchConnections();
    }

    async function deleteConnection(id) {
      if (confirm('確定要刪除此伺服器連線配置嗎？')) {
        const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
        if (res.status === 401) {
          showLoginOverlay();
          return;
        }
        fetchConnections();
      }
    }

    function connectSSH(id, name) {
      document.getElementById('active-terminal-title').textContent = `連線至: ${name}`;
      document.getElementById('terminal-screen').classList.remove('hidden');
      document.getElementById('terminal-screen').classList.add('flex');

      term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Courier New, Courier, monospace',
        fontSize: 14,
        theme: {
          background: '#020617',
          foreground: '#f8fafc',
          cursor: '#10b981'
        }
      });

      fitAddon = new window.FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal-container'));
      fitAddon.fit();
      
      term.focus(); // 自動將焦點聚焦至終端機，免去手動點擊

      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      const wsUrl = `${protocol}${window.location.host}/ssh/${id}`;
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        term.write('\r\n[CF-WebSSH]: 已成功建立通訊隧道，正在連線遠端伺服器...\r\n');
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
        } else {
          term.write(event.data);
        }
      };

      ws.onclose = () => {
        term.write('\r\n[CF-WebSSH]: 連線已中斷。\r\n');
      };

      term.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data: data }));
        }
      });

      window.addEventListener('resize', onWindowResize);
    }

    function onWindowResize() {
      if (fitAddon && term) {
        fitAddon.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: term.cols,
            rows: term.rows
          }));
        }
      }
    }

    function closeTerminal() {
      window.removeEventListener('resize', onWindowResize);
      if (ws) {
        ws.close();
        ws = null;
      }
      if (term) {
        term.dispose();
        term = null;
      }
      document.getElementById('terminal-screen').classList.add('hidden');
      document.getElementById('terminal-screen').classList.remove('flex');
    }
  </script>
</body>
</html>

````

## File: mocks/cpu-features.js
````js
// Mock cpu-features for worker build
const mock = () => ({});
mock.default = mock;
export default mock;

````

## File: package.json
````json
{
  "name": "cf-webssh",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "deploy": "npm run build && wrangler deploy"
  },
  "dependencies": {
    "ssh2": "^1.15.0"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "wrangler": "^3.50.0"
  }
}

````

## File: .github/workflows/deploy.yml
````yml
name: Deploy to Cloudflare Workers

on:
  push:
    branches:
      - main # 當代碼推送到 main 分支時觸發自動部署
  workflow_dispatch: # 支援在 GitHub 網頁上手動點擊觸發部署

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24 # 使用 Node 24 避免棄用警告

      - name: Install Dependencies
        run: npm install

      - name: Auto-detect or Create KV Namespace
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          echo "正在偵測 Cloudflare KV 命名空間..."
          
          # 1. 取得現有的 KV 列表 (將輸出重新導向以確保資訊安全)
          KV_LIST=$(npx wrangler kv namespace list 2>/dev/null)
          
          # 2. 篩選名稱中是否已存在包含 WEBSSH_KV 的 KV ID
          KV_ID=$(echo "$KV_LIST" | jq -r '.[] | select(.title | contains("WEBSSH_KV")) | .id' | head -n 1)
          
          # 3. 如果不存在，則自動建立一個
          if [ -z "$KV_ID" ] || [ "$KV_ID" = "null" ]; then
            echo "未偵測到 WEBSSH_KV 命名空間，正在自動為您建立..."
            # 建立新的命名空間並隱藏詳細輸出
            npx wrangler kv namespace create WEBSSH_KV >/dev/null
            
            # 重新獲取新建後的列表並擷取 ID
            KV_LIST_NEW=$(npx wrangler kv namespace list 2>/dev/null)
            KV_ID=$(echo "$KV_LIST_NEW" | jq -r '.[] | select(.title | contains("WEBSSH_KV")) | .id' | head -n 1)
          else
            echo "已成功偵測到現有的 KV 命名空間，正在進行綁定..."
          fi
          
          # 4. 安全檢查
          if [ -z "$KV_ID" ] || [ "$KV_ID" = "null" ]; then
            echo "錯誤：無法取得或建立 KV 命名空間。"
            exit 1
          fi
          
          # 5. 動態將取得的 KV ID 替換寫入 wrangler.toml (但不輸出內容至 log)
          sed -i "s/KV_NAMESPACE_ID_PLACEHOLDER/$KV_ID/g" wrangler.toml
          echo "KV 綁定已設定完成。"

      - name: Deploy to Cloudflare
        run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

````

## File: .github/workflows/combine-code.yml
````yml
name: Generate All Codebase to MD

on:
  push:
    branches:
      - main
    paths-ignore:
      - 'combined_project_code.md' # 避免此檔案自身更新引發無限循環
  workflow_dispatch: # 支援在 GitHub 網頁上手動觸發執行

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Combine All Files into MD
        run: |
          OUT_FILE="combined_project_code.md"
          echo "# Complete Project Codebase" > "$OUT_FILE"
          echo "Generated on: $(date)" >> "$OUT_FILE"
          echo "" >> "$OUT_FILE"

          # 遍歷專案內的所有檔案，排除依賴、Git 歷史、打包產物及二進位檔案
          find . -type f \
            -not -path "*/node_modules/*" \
            -not -path "*/.git/*" \
            -not -path "*/dist/*" \
            -not -name "package-lock.json" \
            -not -name "yarn.lock" \
            -not -name "pnpm-lock.yaml" \
            -not -name "$OUT_FILE" \
            -not -name "*.png" \
            -not -name "*.jpg" \
            -not -name "*.jpeg" \
            -not -name "*.gif" \
            -not -name "*.ico" \
            -not -name "*.woff*" \
            -not -name "*.ttf" | while read -r file; do
              
              # 取得相對路徑與副檔名
              rel_path="${file#./}"
              ext="${file##*.}"
              
              # 如果無副檔名，清除變數避免格式混亂
              if [ "$ext" = "$rel_path" ]; then
                ext=""
              fi
              
              # 寫入檔案標題
              echo "## File: $rel_path" >> "$OUT_FILE"
              # 使用四個反單引號（````）包裹，防止內部程式碼的三個反單引號造成排版衝突
              echo "\`\`\`\`$ext" >> "$OUT_FILE"
              cat "$file" >> "$OUT_FILE"
              echo "" >> "$OUT_FILE"
              echo "\`\`\`\`" >> "$OUT_FILE"
              echo "" >> "$OUT_FILE"
          done

      - name: Commit and Push changes
        run: |
          git config --local user.email "github-actions[bot]@users.noreply.github.com"
          git config --local user.name "github-actions[bot]"
          git add combined_project_code.md
          
          if git diff --staged --quiet; then
            echo "No changes in codebase."
          else
            git commit -m "docs: auto-generate complete codebase [skip ci]"
            git push origin main
          fi

````

## File: build.mjs
````mjs
import * as esbuild from 'esbuild';

// 定義所有 Node.js 的內建核心模組名稱
const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 
  'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 
  'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'
];

// 建立一個 esbuild 插件，用來忽略二進位原生模組 (.node 檔案)
const ignoreNodeExtensionsPlugin = {
  name: 'ignore-node-extensions',
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, args => ({
      path: args.path,
      namespace: 'ignore-node-extensions-namespace',
    }));

    build.onLoad({ filter: /.*/, namespace: 'ignore-node-extensions-namespace' }, () => ({
      contents: 'module.exports = {};',
      loader: 'js',
    }));
  },
};

// 撰寫具備高度診斷與防禦機制的 Banner 代碼
const bannerJs = `import { createRequire } from 'node:module';
const __filename = 'index.js';
const __dirname = '/';
const _origRequire = createRequire(import.meta.url || 'file:///index.js');
const require = (name) => {
  const nodeBuiltins = ['assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'];
  
  if (name === 'child_process' || name === 'node:child_process') {
    return { spawn: () => {}, exec: () => {}, execFile: () => {}, fork: () => {} };
  }

  let res;
  try {
    res = _origRequire(name);
  } catch (err) {
    try {
      res = _origRequire('node:' + name);
    } catch (err2) {
      return new Proxy({}, {
        get: (t, p) => {
          if (p === 'then') return undefined;
          if (p === 'hasOwnProperty') return () => false;
          return () => {};
        }
      });
    }
  }

  if (typeof res === 'function') {
    return res;
  }

  if (res && typeof res === 'object') {
    const hasProto = (Object.getPrototypeOf(res) !== null);

    if (hasProto) {
      return res;
    }

    const ns = res;
    const baseName = name.replace(/^node:/, '');
    let ctor = null;

    if (typeof ns.default === 'function') {
      ctor = ns.default;
    } else if (typeof ns[baseName] === 'function') {
      ctor = ns[baseName];
    } else {
      const pascal = baseName.charAt(0).toUpperCase() + baseName.slice(1);
      if (typeof ns[pascal] === 'function') ctor = ns[pascal];
    }

    if (ctor) {
      for (const key of Object.getOwnPropertyNames(ns)) {
        if (key !== 'default' && key !== '__esModule' && !(key in ctor)) {
          try { ctor[key] = ns[key]; } catch(e) {}
        }
      }
      if (typeof ctor.hasOwnProperty !== 'function') {
        ctor.hasOwnProperty = Object.prototype.hasOwnProperty.bind(ctor);
      }
      return ctor;
    }

    const wrapper = function() {};
    for (const key of Object.getOwnPropertyNames(ns)) {
      if (key !== '__esModule' && key !== 'constructor') {
        try { wrapper[key] = ns[key]; } catch(e) {}
      }
    }
    if (typeof wrapper.hasOwnProperty !== 'function') {
      wrapper.hasOwnProperty = Object.prototype.hasOwnProperty.bind(wrapper);
    }
    return wrapper;
  }

  return res;
};`;

try {
  await esbuild.build({
    entryPoints: ['src/index.js'],
    bundle: true,
    outfile: 'dist/index.js',
    format: 'esm',
    target: 'es2022',
    platform: 'browser', 
    external: [
      'cloudflare:sockets',
      ...nodeBuiltins,
      ...nodeBuiltins.map(name => `node:${name}`)
    ],
    banner: {
      js: bannerJs,
    },
    plugins: [ignoreNodeExtensionsPlugin],
    loader: {
      '.html': 'text',
    },
    alias: {
      'cpu-features': './mocks/cpu-features.js'
    }
  });
  console.log('Build completed successfully.');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}

````

