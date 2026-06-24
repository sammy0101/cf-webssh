# Complete Project Codebase
Generated on: Wed Jun 24 15:44:09 UTC 2026

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
import { Readable } from 'node:stream';
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

    // 安全防禦門禁：若啟用密碼驗證且未授權，阻擋所有非公開路徑
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

    // 6. WebSocket 單一通道 SFTP 全功能管理器 (防禦性優化)
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
      let uploadStream = null;
      let downloadStream = null;

      sshClient.on('ready', () => {
        sshClient.sftp((err, sftp) => {
          if (err) {
            server.send(JSON.stringify({ status: 'error', message: `SFTP 啟用失敗: ${err.message}` }));
            server.close(1011);
            sshClient.end();
            return;
          }
          sftpClient = sftp;
          // 通知前端 SFTP 已成功初始化，此時前端才可以發送指令
          server.send(JSON.stringify({ status: 'ready' }));
        });
      });

      sshClient.on('error', (err) => {
        server.send(JSON.stringify({ status: 'error', message: `SSH 連線錯誤: ${err.message}` }));
        server.close(1011);
      });

      // 接收 SFTP 管理控制封包
      server.addEventListener('message', async (event) => {
        // A. 處理上傳檔案的二進位區塊 (Chunk)
        if (event.data instanceof ArrayBuffer) {
          if (uploadStream) {
            const chunk = new Uint8Array(event.data);
            uploadStream.write(chunk, (err) => {
              if (err) {
                server.send(JSON.stringify({ status: 'error', message: `寫入失敗: ${err.message}` }));
                return;
              }
              server.send(JSON.stringify({ status: 'upload_ack', written: chunk.length }));
            });
          } else {
            server.send(JSON.stringify({ status: 'error', message: '未建立有效的寫入串流' }));
          }
          return;
        }

        // B. 處理 JSON 格式之控制指令
        try {
          const msg = JSON.parse(event.data);

          // 核心防禦性檢查：若 SFTP 尚未 Ready，拒絕所有前端控制指令
          if (!sftpClient) {
            server.send(JSON.stringify({ status: 'error', message: '遠端 SSH/SFTP 連線仍在建立中，請稍候。' }));
            return;
          }

          // 1. 取得檔案列表
          if (msg.action === 'list') {
            sftpClient.realpath(msg.path || '.', (err, absPath) => {
              const targetPath = err ? (msg.path || '.') : absPath;
              sftpClient.readdir(targetPath, (err, list) => {
                if (err) {
                  server.send(JSON.stringify({ status: 'error', message: `讀取遠端目錄失敗: ${err.message}` }));
                  return;
                }
                const files = list.map(item => ({
                  name: item.filename,
                  size: item.attrs.size,
                  isDir: item.attrs.isDirectory(),
                  modifyTime: item.attrs.mtime
                })).sort((a, b) => {
                  if (a.isDir && !b.isDir) return -1;
                  if (!a.isDir && b.isDir) return 1;
                  return a.name.localeCompare(b.name);
                });
                server.send(JSON.stringify({ status: 'list', path: targetPath, files }));
              });
            });
          }

          // 2. 刪除檔案或資料夾
          else if (msg.action === 'delete') {
            const callback = (err) => {
              if (err) {
                server.send(JSON.stringify({ status: 'error', message: `刪除遠端對象失敗: ${err.message}` }));
              } else {
                server.send(JSON.stringify({ status: 'delete_ok' }));
              }
            };
            if (msg.isDir) {
              sftpClient.rmdir(msg.path, callback);
            } else {
              sftpClient.unlink(msg.path, callback);
            }
          }

          // 3. 啟動檔案上傳
          else if (msg.action === 'upload_start') {
            uploadStream = sftpClient.createWriteStream(msg.path, { flags: 'w', mode: 0o644 });
            uploadStream.on('error', (err) => {
              server.send(JSON.stringify({ status: 'error', message: `開啟遠端寫入串流出錯: ${err.message}` }));
            });
            server.send(JSON.stringify({ status: 'upload_ready' }));
          }

          // 4. 結束檔案上傳
          else if (msg.action === 'upload_end') {
            if (uploadStream) {
              uploadStream.end(() => {
                uploadStream = null;
                server.send(JSON.stringify({ status: 'upload_ok' }));
              });
            } else {
              server.send(JSON.stringify({ status: 'upload_ok' }));
            }
          }

          // 5. 取消上傳
          else if (msg.action === 'upload_cancel') {
            if (uploadStream) {
              uploadStream.end(() => {
                uploadStream = null;
              });
            }
          }

          // 6. 啟動檔案下載 (流量控制)
          else if (msg.action === 'download_start') {
            const filename = msg.path.split('/').pop() || 'download';
            downloadStream = sftpClient.createReadStream(msg.path);
            
            server.send(JSON.stringify({ status: 'download_meta', filename }));

            downloadStream.on('data', (chunk) => {
              downloadStream.pause();
              server.send(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
            });

            downloadStream.on('end', () => {
              downloadStream = null;
              server.send(JSON.stringify({ status: 'download_end' }));
            });

            downloadStream.on('error', (err) => {
              downloadStream = null;
              server.send(JSON.stringify({ status: 'error', message: `讀取遠端檔案出錯: ${err.message}` }));
            });
          }

          // 7. 請求下載下一個檔案區塊
          else if (msg.action === 'download_next') {
            if (downloadStream) {
              downloadStream.resume();
            }
          }

        } catch (e) {
          server.send(JSON.stringify({ status: 'error', message: `SFTP 協定解析錯誤: ${e.message}` }));
        }
      });

      server.addEventListener('close', () => {
        if (uploadStream) uploadStream.end();
        if (downloadStream) downloadStream.destroy();
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
            kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group14-sha256', 'diffie-hellman-group16-sha512', 'diffie-hellman-group-exchange-sha256'],
            cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-cbc', 'aes192-cbc', 'aes256-cbc']
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
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-sm shadow-2xl text-center">
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

  <!-- 終端機全螢幕容器 (z-50) -->
  <div id="terminal-screen" class="fixed inset-0 bg-black hidden flex-col z-50">
    <!-- 頂部資訊與控制欄 -->
    <div class="bg-slate-900 px-4 py-2 flex justify-between items-center border-b border-slate-800 text-sm">
      <div class="flex items-center space-x-3">
        <span id="active-terminal-title" class="font-mono text-slate-300">連線中...</span>
        
        <span class="text-slate-700 hidden md:inline">|</span>
        <!-- 檔案瀏覽器彈窗切換主按鈕 -->
        <button onclick="toggleSftpModal()" class="text-xs bg-slate-800 hover:bg-slate-700 hover:text-emerald-300 text-emerald-400 border border-slate-700 px-2.5 py-1 rounded font-medium transition flex items-center gap-1.5">
          📁 SFTP 檔案管理
        </button>
        <span class="text-xs text-slate-500 hidden lg:inline">（亦支援滑鼠直接拖曳本機檔案至終端機內放開上傳）</span>
        
        <!-- 隱藏的檔案選擇 input -->
        <input type="file" id="sftp-file-input" class="hidden" onchange="handleFileSelect(event)">
      </div>
      <button onclick="closeTerminal()" class="bg-rose-700 hover:bg-rose-600 px-3 py-1 rounded text-white transition">
        中斷連線
      </button>
    </div>

    <!-- 工作區域：終端機容器 -->
    <div class="flex-1 flex overflow-hidden">
      <div id="terminal-container" class="flex-1 p-2 bg-black relative">
         <!-- SFTP 拖放上傳提示遮罩 -->
         <div id="dropzone-overlay" class="absolute inset-0 bg-emerald-950/85 border-4 border-dashed border-emerald-400 hidden flex-col items-center justify-center z-40 pointer-events-none">
           <div class="text-center p-6">
             <svg class="w-16 h-16 text-emerald-400 mx-auto mb-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
             </svg>
             <p class="text-xl font-bold text-emerald-300">拖放到此處上傳至當前資料夾</p>
             <p class="text-xs text-slate-400 mt-2">（將自動上傳至檔案管理器目前瀏覽的目錄中）</p>
           </div>
         </div>
      </div>
    </div>
  </div>

  <!-- SFTP 檔案管理器中央彈窗 Modal (提升層級為 z-[60]，解決被終端機 z-50 擋在底下的問題) -->
  <div id="sftp-modal" class="fixed inset-0 bg-black/80 hidden items-center justify-center p-4 z-[60]">
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in">
      
      <!-- 標題欄 -->
      <div class="pb-3 border-b border-slate-800 flex justify-between items-center bg-slate-900">
        <h3 class="font-bold text-emerald-400 text-base flex items-center gap-1.5">
          📁 SFTP 遠端檔案管理器
        </h3>
        <button onclick="toggleSftpModal()" class="text-slate-400 hover:text-white text-sm font-bold p-1">
          關閉 ✕
        </button>
      </div>
      
      <!-- 操作控制與上傳按鈕 -->
      <div class="py-3 border-b border-slate-800 bg-slate-900 flex items-center gap-2 justify-between">
        <div class="flex items-center gap-2">
          <button onclick="sftpGoUp()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1" title="返回上層目錄">
            向上 ↩
          </button>
          <button onclick="refreshSftpList()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1" title="重新整理列表">
            整理 ↻
          </button>
        </div>
        <!-- 手動上傳按鈕 -->
        <button onclick="triggerFileInput()" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded font-semibold transition flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
          </svg>
          上傳檔案
        </button>
      </div>

      <!-- 目前目錄路徑顯示欄 -->
      <div class="p-2 border-b border-slate-800 bg-slate-950 flex items-center gap-1">
        <span class="text-xs text-slate-500 font-mono">路徑:</span>
        <input type="text" id="sftp-current-path" readonly class="flex-1 bg-transparent border-none text-slate-300 text-[11px] font-mono select-all focus:outline-none">
      </div>

      <!-- 檔案與資料夾清單區 -->
      <div id="sftp-file-list" class="flex-1 overflow-y-auto p-4 space-y-1.5 text-xs font-mono select-none">
        <!-- 動態渲染清單 -->
      </div>
    </div>
  </div>

  <!-- 上傳與下載進度顯示遮罩 (維持 z-50 原樣) -->
  <div id="upload-overlay" class="fixed inset-0 bg-black/70 hidden items-center justify-center p-4 z-50">
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-sm shadow-2xl text-center">
      <h3 class="text-lg font-bold text-emerald-400 mb-2">傳輸處理中 (SFTP)</h3>
      <p id="upload-file-info" class="text-sm text-slate-300 font-mono truncate mb-4">filename.txt</p>
      <div class="w-full bg-slate-800 rounded-full h-4 overflow-hidden mb-3">
        <div id="upload-progress-bar" class="bg-emerald-500 h-full w-0 transition-all duration-150"></div>
      </div>
      <div class="flex justify-between text-xs text-slate-400 font-mono">
        <span id="upload-progress-percent">處理中...</span>
        <span id="upload-progress-size">0.00 / 0.00 MB</span>
      </div>
      <div class="mt-6 flex justify-center">
        <button onclick="cancelUpload()" class="px-4 py-1.5 bg-rose-700 hover:bg-rose-600 rounded text-sm text-white font-medium transition">取消</button>
      </div>
    </div>
  </div>

  <script>
    let ws = null;
    let term = null;
    let fitAddon = null;
    let sftpWs = null;               // 單一、永久活耀的 SFTP WebSocket 通道
    let sftpUploadCancelled = false; // 是否取消傳輸標記
    let activeConnectionId = null;   // 當前終端連線伺服器 ID
    let sftpCurrentPath = '.';       // 當前檔案管理器絕對路徑
    let sftpModalOpen = false;       // 檔案管理器彈窗開關狀態 (改為 Modal)
    let sftpFileChunks = [];         // 用於下載儲存二進位區塊
    let currentDownloadingFilename = ''; // 當前正在下載的檔名
    let uploadFile = null;           // 當前正在上傳的 File 物件
    let uploadOffset = 0;            // 上傳目前偏移行數
    const uploadChunkSize = 64 * 1024; // 上傳分塊大小

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

    // 5. 初始化拖放檔案監聽器
    function initDragAndDrop(connectionId) {
      const screen = document.getElementById('terminal-screen');
      const dropzone = document.getElementById('dropzone-overlay');

      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        screen.addEventListener(eventName, preventDefaults, false);
      });

      function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      screen.addEventListener('dragenter', () => {
        dropzone.classList.remove('hidden');
        dropzone.classList.add('flex');
      }, false);

      screen.addEventListener('dragover', () => {
        dropzone.classList.remove('hidden');
        dropzone.classList.add('flex');
      }, false);

      screen.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null || !screen.contains(e.relatedTarget)) {
          dropzone.classList.add('hidden');
          dropzone.classList.remove('flex');
        }
      }, false);

      screen.addEventListener('drop', (e) => {
        dropzone.classList.add('hidden');
        dropzone.classList.remove('flex');

        const dt = e.dataTransfer;
        const files = dt.files;

        if (files && files.length > 0) {
          // 判斷 SFTP 通道是否就緒，若未就緒自動打開面板建立通道並上傳
          if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) {
            toggleSftpModal();
            // 等待一小段時間確保連線建立
            setTimeout(() => {
              handleSftpUpload(connectionId, files[0]);
            }, 1200);
          } else {
            handleSftpUpload(connectionId, files[0]);
          }
        }
      }, false);
    }

    // 5.1 手動點擊「SFTP 上傳檔案」按鈕觸發事件
    function triggerFileInput() {
      document.getElementById('sftp-file-input').click();
    }

    // 5.2 選擇本機檔案完成後的處理程序
    function handleFileSelect(event) {
      const files = event.target.files;
      if (files && files.length > 0 && activeConnectionId) {
        handleSftpUpload(activeConnectionId, files[0]);
        event.target.value = '';
      }
    }

    // 6. 建立單一 SFTP WebSocket 安全連線 (修復非同步競合 Race Condition)
    function connectSftpWebSocket() {
      if (!activeConnectionId) return;
      const fileListContainer = document.getElementById('sftp-file-list');
      fileListContainer.innerHTML = '<div class="text-slate-500 text-center py-8">建立安全 SFTP 通道中...</div>';

      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      const wsUrl = `${protocol}${window.location.host}/sftp/${activeConnectionId}`;
      sftpWs = new WebSocket(wsUrl);
      sftpWs.binaryType = 'arraybuffer';

      sftpWs.onopen = () => {
        sftpCurrentPath = '.';
        fileListContainer.innerHTML = '<div class="text-slate-500 text-center py-8">正在連線遠端伺服器 (SSH)...</div>';
      };

      sftpWs.onmessage = async (event) => {
        // I. 處理檔案下載的二進位區塊 (Chunk)
        if (event.data instanceof ArrayBuffer) {
          sftpFileChunks.push(event.data);
          
          // 前端回覆 ACK 確認以請求下一區塊（流量控制，防止 Worker 和前端記憶體溢位）
          sftpWs.send(JSON.stringify({ action: 'download_next' }));
          
          const downloadedBytes = sftpFileChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
          document.getElementById('upload-progress-percent').textContent = '下載中...';
          document.getElementById('upload-progress-size').textContent = `${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`;
          return;
        }

        // II. 處理 JSON 格式控制回饋指令
        try {
          const msg = JSON.parse(event.data);

          if (msg.status === 'error') {
            alert(`SFTP 操作失敗: ${msg.message}`);
            closeUploadOverlay();
            if (fileListContainer.innerHTML.includes('正在')) {
               fileListContainer.innerHTML = `<div class="text-rose-400 p-4 text-center">連線失敗: ${msg.message}</div>`;
            } else {
               refreshSftpList();
            }
            return;
          }

          // 當後端 SSH 和 SFTP 元件完全就緒後，再發送首個目錄列表要求
          if (msg.status === 'ready') {
            sftpWs.send(JSON.stringify({ action: 'list', path: sftpCurrentPath }));
          }

          // A. 檔案清單渲染
          else if (msg.status === 'list') {
            sftpCurrentPath = msg.path;
            document.getElementById('sftp-current-path').value = sftpCurrentPath;
            renderSftpFiles(msg.files);
          }

          // B. 刪除完成
          else if (msg.status === 'delete_ok') {
            refreshSftpList();
          }

          // C. 後端已開啟寫入流，通知前端可以開始發送檔案二進位分塊
          else if (msg.status === 'upload_ready') {
            sendNextUploadChunk();
          }

          // D. 上傳分塊寫入成功之 ACK 信號
          else if (msg.status === 'upload_ack') {
            handleUploadAck(msg.written);
          }

          // E. 上傳結束成功
          else if (msg.status === 'upload_ok') {
            term.write(`\r\n[CF-WebSSH]: 檔案上傳成功！已儲存至 ${sftpCurrentPath} 檔案路徑。\r\n`);
            closeUploadOverlay();
            refreshSftpList();
          }

          // F. 開始下載之 Metadata
          else if (msg.status === 'download_meta') {
            sftpFileChunks = [];
            currentDownloadingFilename = msg.filename;

            const uploadOverlay = document.getElementById('upload-overlay');
            const fileInfo = document.getElementById('upload-file-info');
            const progressBar = document.getElementById('upload-progress-bar');
            
            fileInfo.textContent = `下載: ${currentDownloadingFilename}`;
            progressBar.style.width = '100%';
            document.getElementById('upload-progress-percent').textContent = '開始下載...';
            document.getElementById('upload-progress-size').textContent = '0.00 MB';

            uploadOverlay.classList.remove('hidden');
            uploadOverlay.classList.add('flex');

            // 發送確認，開始提取第一個區塊
            sftpWs.send(JSON.stringify({ action: 'download_next' }));
          }

          // G. 下載結束
          else if (msg.status === 'download_end') {
            const blob = new Blob(sftpFileChunks, { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = currentDownloadingFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            closeUploadOverlay();
          }

        } catch (e) {
          console.error("SFTP 接收命令解析失敗:", e);
        }
      };

      sftpWs.onerror = () => {
        fileListContainer.innerHTML = '<div class="text-rose-400 p-4 text-center">SFTP 通道建立失敗</div>';
      };

      sftpWs.onclose = () => {
        fileListContainer.innerHTML = '<div class="text-slate-500 p-4 text-center">SFTP 通道已關閉</div>';
      };
    }

    function disconnectSftpWebSocket() {
      if (sftpWs) {
        sftpWs.close();
        sftpWs = null;
      }
    }

    // 6.1 開關檔案管理器彈出視窗 (修改為 Modal 視窗形式，保證絕對可見性)
    function toggleSftpModal() {
      const modal = document.getElementById('sftp-modal');
      sftpModalOpen = !sftpModalOpen;
      
      if (sftpModalOpen) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        connectSftpWebSocket();
      } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        disconnectSftpWebSocket();
      }
    }

    // 6.2 重新整理 SFTP 檔案清單
    function refreshSftpList() {
      if (sftpWs && sftpWs.readyState === WebSocket.OPEN) {
        sftpWs.send(JSON.stringify({ action: 'list', path: sftpCurrentPath }));
      }
    }

    // 6.3 渲染遠端目錄檔案至 UI
    function renderSftpFiles(files) {
      const fileListContainer = document.getElementById('sftp-file-list');
      fileListContainer.innerHTML = '';

      if (files.length === 0) {
        fileListContainer.innerHTML = '<div class="text-slate-500 text-center py-8">（此目錄為空）</div>';
        return;
      }

      files.forEach(file => {
        if (file.name === '.' || file.name === '..') return;

        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-1.5 rounded hover:bg-slate-800 group transition duration-150";
        
        const icon = file.isDir ? '📁' : '📄';
        const sizeStr = file.isDir ? '' : ` (${(file.size / 1024).toFixed(1)} KB)`;
        
        const info = document.createElement('div');
        info.className = `flex items-center gap-1.5 truncate flex-1 ${file.isDir ? 'text-amber-400 font-bold cursor-pointer hover:underline' : 'text-slate-300'}`;
        info.innerHTML = `<span>${icon}</span><span class="truncate" title="${file.name}">${file.name}${sizeStr}</span>`;
        
        if (file.isDir) {
          info.onclick = () => {
            sftpCurrentPath = sftpCurrentPath === '/' ? `/${file.name}` : `${sftpCurrentPath}/${file.name}`;
            refreshSftpList();
          };
        }

        const actions = document.createElement('div');
        actions.className = "flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition duration-150 pl-2";
        
        if (!file.isDir) {
          // 下載按鈕
          const dlBtn = document.createElement('button');
          dlBtn.className = "text-emerald-400 hover:text-emerald-300 bg-slate-950 px-1 py-0.5 rounded text-[10px] font-medium";
          dlBtn.textContent = '下載';
          dlBtn.onclick = (e) => {
            e.stopPropagation();
            sftpDownloadFile(file.name);
          };
          actions.appendChild(dlBtn);
        }

        // 刪除按鈕
        const delBtn = document.createElement('button');
        delBtn.className = "text-rose-400 hover:text-rose-300 bg-slate-950 px-1 py-0.5 rounded text-[10px] font-medium";
        delBtn.textContent = '刪除';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          sftpDeleteFile(file.name, file.isDir);
        };
        actions.appendChild(delBtn);

        item.appendChild(info);
        item.appendChild(actions);
        fileListContainer.appendChild(item);
      });
    }

    // 6.4 向上導航
    function sftpGoUp() {
      if (sftpCurrentPath === '/' || sftpCurrentPath === '.') return;
      const parts = sftpCurrentPath.split('/');
      parts.pop();
      sftpCurrentPath = parts.join('/') || '/';
      refreshSftpList();
    }

    // 6.5 下載遠端檔案
    function sftpDownloadFile(filename) {
      if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) return;
      const targetPath = sftpCurrentPath === '/' ? `/${filename}` : `${sftpCurrentPath}/${filename}`;
      sftpWs.send(JSON.stringify({ action: 'download_start', path: targetPath }));
    }

    // 6.6 刪除遠端對象
    function sftpDeleteFile(filename, isDir) {
      if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) return;
      const typeStr = isDir ? '資料夾' : '檔案';
      if (!confirm(`確定要永久刪除此${typeStr}嗎？ (${filename})`)) return;

      const targetPath = sftpCurrentPath === '/' ? `/${filename}` : `${sftpCurrentPath}/${filename}`;
      sftpWs.send(JSON.stringify({ action: 'delete', path: targetPath, isDir }));
    }

    // 6.7 執行 SFTP 上傳
    function handleSftpUpload(connectionId, file) {
      if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) {
        alert('SFTP 安全通道尚未就緒，請重試。');
        return;
      }
      sftpUploadCancelled = false;
      uploadFile = file;
      uploadOffset = 0;

      const uploadOverlay = document.getElementById('upload-overlay');
      const fileInfo = document.getElementById('upload-file-info');
      const progressBar = document.getElementById('upload-progress-bar');
      const progressPercent = document.getElementById('upload-progress-percent');
      const progressSize = document.getElementById('upload-progress-size');

      fileInfo.textContent = `上傳: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
      progressBar.style.width = '0%';
      progressPercent.textContent = '0%';
      progressSize.textContent = `0.00 / ${(file.size / 1024 / 1024).toFixed(2)} MB`;

      uploadOverlay.classList.remove('hidden');
      uploadOverlay.classList.add('flex');

      // 告訴遠端準備上傳
      const targetPath = sftpCurrentPath === '/' ? `/${file.name}` : `${sftpCurrentPath}/${file.name}`;
      sftpWs.send(JSON.stringify({ action: 'upload_start', filename: file.name, path: targetPath }));
    }

    // 6.8 發送上傳分塊封包
    function sendNextUploadChunk() {
      const nextSize = Math.min(uploadChunkSize, uploadFile.size - uploadOffset);
      const slice = uploadFile.slice(uploadOffset, uploadOffset + nextSize);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        if (sftpWs && sftpWs.readyState === WebSocket.OPEN) {
          sftpWs.send(e.target.result); // 發送二進位分塊
        }
      };
      reader.readAsArrayBuffer(slice);
    }

    // 6.9 處理分塊 ACK 響應
    function handleUploadAck(written) {
      if (sftpUploadCancelled) return;
      uploadOffset += written;

      const progressBar = document.getElementById('upload-progress-bar');
      const progressPercent = document.getElementById('upload-progress-percent');
      const progressSize = document.getElementById('upload-progress-size');

      const percent = Math.min(100, Math.floor((uploadOffset / uploadFile.size) * 100));
      progressBar.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      progressSize.textContent = `${(uploadOffset / 1024 / 1024).toFixed(2)} / ${(uploadFile.size / 1024 / 1024).toFixed(2)} MB`;

      if (uploadOffset < uploadFile.size) {
        sendNextUploadChunk();
      } else {
        // 完成上傳
        sftpWs.send(JSON.stringify({ action: 'upload_end' }));
      }
    }

    function cancelUpload() {
      sftpUploadCancelled = true;
      if (sftpWs && sftpWs.readyState === WebSocket.OPEN) {
        sftpWs.send(JSON.stringify({ action: 'upload_cancel' }));
      }
      closeUploadOverlay();
      term.write(`\r\n[CF-WebSSH]: 使用者手動取消了傳輸工作。\r\n`);
      refreshSftpList();
    }

    function closeUploadOverlay() {
      document.getElementById('upload-overlay').classList.add('hidden');
      document.getElementById('upload-overlay').classList.remove('flex');
      uploadFile = null;
    }

    // 7. 連線至 SSH 終端機
    function connectSSH(id, name) {
      activeConnectionId = id; // 保存當前伺服器連線 ID
      document.getElementById('active-terminal-title').textContent = `連線至: ${name}`;
      document.getElementById('terminal-screen').classList.remove('hidden');
      document.getElementById('terminal-screen').classList.add('flex');

      // 初始化拖放監聽器
      initDragAndDrop(id);

      // 初始化 xterm.js
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
      // 關閉終端機時，同步隱藏檔案管理器並中斷連線
      if (sftpModalOpen) {
        toggleSftpModal();
      }
      activeConnectionId = null; // 清空伺服器連線 ID
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

