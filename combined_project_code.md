# Complete Project Codebase
Generated on: Thu Jun 25 10:44:21 UTC 2026

## File: README.md
````md
# cf-webssh

一個基於 Cloudflare Workers 平台構建的輕量級 WebSSH 與 SFTP 遠端檔案管理工具。

本專案利用 Cloudflare 原生 TCP 接口（透過相容性標誌 `nodejs_compat` 啟用 `cloudflare:sockets`）與遠端主機建立安全的 SSH 通道，並在瀏覽器前端使用 `xterm.js` 提供高度互動性的終端體驗與視覺化檔案管理。

## 🎯 專案特點

- **無伺服器架構**：完全依賴 Cloudflare Workers 邊緣網路，無需部署與維護傳統的 WebSSH 後端伺服器（如 Bastion、Guacamole 等）。
- **可選的管理密碼保護**：
  - 支援設置環境變數 `ADMIN_PASSWORD` 作為管理員登入密碼。
  - **向下相容**：若未配置該變數，系統會自動切換為免密碼模式（不顯示登入頁面），行為與原版本一致。
  - **安全 Session 保護**：採用具有 `HttpOnly`、`Secure`、`SameSite=Strict` 屬性的安全 Cookie，能同時且安全地為 API 接口與 WebSocket 握手進行無狀態認證保護。
  - **完整登出機制**：前端支援一鍵登出清除 Session。
- **多伺服器配置管理**：支援記錄與維護多台伺服器的連線。所有主機資訊（不含密碼/私鑰）與敏感認證憑據（密碼、SSH 私鑰）皆安全地儲存於您個人的 Cloudflare KV 命名空間中。
- **安全編輯與局部更新**：提供完整的「新增、刪除、編輯」功能。前端卡片支援一鍵編輯，且後端 `POST` API 具備局部合併機制，若您在編輯伺服器時未重新填寫密碼或私鑰，系統會自動保留原先在 KV 中的敏感認證資訊，避免遺失。
- **一體化 SFTP 遠端檔案管理器**：
  - 前端頂部整合為單一 **「📁 SFTP 檔案管理」** 彈窗視窗，可直接在終端機畫面上方彈出，體驗一體化。
  - **「類 Windows」麵包屑導航**：自動將目前的絕對路徑分割為可點選的級聯節點（如 `🏠 / root / apps`），點選即可快速跨目錄跳轉。
  - **檔案瀏覽與導航**：點選資料夾可直接進入，支援目錄深層導航、向上返回與重新整理。
  - **檔案下載與完整性流控制（Backpressure）**：採用 Web 串流控制，發送一塊數據確認一塊，絕不撐爆 Worker 記憶體，支援超大檔案的安全流式下載。
  - **拖放與手動上傳**：支援將電腦檔案直接拖曳至終端機畫面上傳，或點選視窗內的「上傳檔案」手動選取，自動上傳至目前瀏覽的目錄中。
  - **檔案刪除**：支援一鍵永久刪除遠端 VPS 上的檔案或空資料夾。
- **優雅的系統圖示與 LOGO**：
  - **網站 Favicon**：採用動態嵌入的 SVG Data-URI 技術，完美替換分頁標籤上的地球預設圖標。
  - **主視覺 LOGO**：主畫面與登入介面皆整合了極具現代感的終端機游標圖示（`>_`）。
- **優化的 xterm.js 終端**：
  - **自動聚焦 (Auto Focus)**：連線載入完成後自動鎖定焦點，無需手動用滑鼠點擊即可直接開始打字輸入。
  - **視窗尺寸動態同步**：支援瀏覽器視窗縮放時，自動向遠端虛擬終端（Pseudo-terminal, PTY）發送 `resize` 訊號。
- **Cloudflare Workers 專屬相容性適配**：
  - 針對 Workers 執行環境底層 BoringSSL 在計算 **X25519 DH 共享金鑰** 時的限制，主動排除 `curve25519` 相關的金鑰交換演算法（KEX），改用 NIST 標準曲線（如 `ecdh-sha2-nistp256`）或有限域 Diffie-Hellman 演算法進行握手。
  - 針對 Workers 的 `node:crypto` 串流解密不完整支援 AEAD 模式（如 `chacha20-poly1305`、`aes-gcm`）而會拋出 `No auth tag provided` 的限制，主動在握手階段限制僅協商使用 **CTR 計數器模式** 與 **CBC 模式**（如 `aes256-ctr`），配合獨立的 HMAC 校驗（如 `hmac-sha2-256`），確保資料傳輸穩定不中斷。

## ⚙️ 系統需求

- [Cloudflare 帳戶](https://dash.cloudflare.com/)
- [Node.js](https://nodejs.org/) (建議使用 v18.0.0 以上之版本)

## 🚀 部署指南

### 方法 A：透過 GitHub Actions 自動部署（推薦）

本專案已內建完整的 CI/CD 自動化工作流。當您將專案推送到 GitHub 的 `main` 分支時，系統將會**全自動處理 KV 命名空間**：

1. Fork 本項目。
2. 在 GitHub 專案的 `Settings -> Secrets and variables -> Actions` 中，新增一個名為 `CLOUDFLARE_API_TOKEN` 的 Secret（此 Token 需具備編輯 Workers 與 KV 命名空間的權限）。
3. 將代碼推送至 `main` 分支。
4. GitHub Actions 工作流（`.github/workflows/deploy.yml`）會自動偵測您的 Cloudflare 帳戶中是否已存在 `WEBSSH_KV` 命名空間。若不存在，將自動為您建立，並**自動動態填入** `wrangler.toml` 中的 `KV_NAMESPACE_ID_PLACEHOLDER`，最後完成編譯與部署。您無需進行任何手動文件修改。

> 💡 **如何在使用 GitHub Actions 部署時設置登入密碼與 AES 加密金鑰？**
> 請直接登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)，進入您的 Workers 項目，點選 `Settings` -> `Variables` -> `Environment Variables`，手動新增變數 `ADMIN_PASSWORD`。為了安全起見，請務必將其儲存類型設為 **Encrypt (Secret)**。此密碼一經儲存，除了用於登入外，還會自動在後端作為 AES-GCM 金鑰。

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

## 🛡️ Cloudflare Zero Trust (Access) 安全加固詳細教學

若要實現企業級的邊緣安全防護，極力建議您使用 Cloudflare 的 **Zero Trust (Access)** 來保護您的 WebSSH 專案。這能在外部請求觸發 Workers 與 KV 資料庫之前，強制對其進行一線身分驗證。

### 📌 前提條件
1. 您在 Cloudflare 上擁有一個已啟用的自訂網域（例如 `yourdomain.com`）。
2. 已為此 Workers 綁定了自訂網域（在 Workers 控制台 -> `Settings` -> `Domains & Routes` -> `Add` -> 綁定如 `ssh.yourdomain.com`）。

### 🛠️ 步驟 1：開啟 Zero Trust 控制台
1. 登入 [Cloudflare 控制面板](https://dash.cloudflare.com/)。
2. 在左側選單中，點擊 **「Zero Trust」**（若第一次進入，請按指示啟用免費訂閱計劃，支援最多 50 名使用者免費）。

### 🛠️ 步驟 2：建立 Access 應用程式
1. 在 Zero Trust 控制台左側選單，依序點擊 **「Access」** -> **「Applications」**。
2. 點擊右上角的 **「Add an Application」（新增應用程式）**。
3. 選擇 **「Self-hosted」（自我託管）** 類型。

### 🛠️ 步驟 3：配置應用程式路徑
1. **Application Name**：自訂一個名稱（如 `WebSSH Panel`）。
2. **Session Duration**：保持預設，或自訂登入狀態有效期限。
3. **Application Domain**（核心步驟）：
   * **Subdomain**：輸入您的子網域（如 `ssh`）。
   * **Domain**：選取您的自訂網域（如 `yourdomain.com`）。
   * **Path**：保留空白即可（意即保護此子網域下的所有路徑，如 `ssh.yourdomain.com/*`）。
4. 滾動到下方，點擊 **「Next」**。

### 🛠️ 步驟 4：設定存取驗證策略 (Access Policy)
1. **Policy Name**：自訂策略名稱（如 `限本人登入`）。
2. **Action**：選擇 `Allow`。
3. **Configure Rules (Include)**（設定允許的對象）：
   * **Selector**：下拉選取 **「Emails」**。
   * **Value**：輸入您個人的 Email 電子郵件（例如 `yourname@gmail.com`）。
   * *提示：您也可以選擇「Email domains」並填入特定的域名（如 `yourcompany.com`），以允許該網域下的所有員工登入；或者配置 GitHub SSO / Google 登入。*
4. 點擊 **「Next」**。

### 🛠️ 步驟 5：設定 cookie 與完成
1. 在最後一個「Setup」頁面，保持預設值不變。
2. 點擊右下角的 **「Add Application」** 保存。

---

### 🎉 防護效果測試
現在，不論是您自己或是任何外部使用者，在瀏覽器輸入 `https://ssh.yourdomain.com` 時，都不會直接看到您的 WebSSH 主介面。而是會自動跳轉至 **Cloudflare Access 安全登入頁面**，要求輸入電子郵件：
1. 輸入您的 Email，Cloudflare 將發送一個 **一次性動態密碼 (OTP)** 至您的信箱。
2. 輸入 OTP 通過驗證後，網頁才會順利載入您的 WebSSH 專案。
3. **這是在網際網路最前線（邊緣節點）攔截惡意流量的極限安全手段！**

## 📝 關於 Cloudflare 網頁編輯器的「紅字錯誤」提示說明

當您打開 Cloudflare Workers 網頁控制台的 **「Quick Edit（快速編輯）」** 線上代碼編輯器時，可能會在 `index.js`（即上傳的打包檔，約 22,000 行）看見數百個紅色或黃色的型別錯誤提示（例如：`Cannot find name 'Buffer'` 或 `Property 'performance' does not exist`）。

* **原因**：控制台網頁編輯器底層使用的是簡化版的 Monaco 靜態檢查器。當它嘗試型別分析這份包含了 `ssh2` 與 Node.js 相容層（Polyfills）的超大型編譯產物時，會因為看不懂 Node.js 原生 API 而報錯。
* **解決與影響**：這**完全不影響代碼的實際運行**，僅僅是線上編輯器前端的顯示干擾。本專案已在編譯腳本 `build.mjs` 中自動將 `// @ts-nocheck` 寫入檔案頂端。如果您在網頁編輯器中仍看見紅字，請**手動重新整理網頁編輯器分頁 (Ctrl + F5)** 以清除瀏覽器的檔案快取，紅字與驚嘆號便會隨之清除。

## 🔒 安全性建議

1. **啟用內建密碼**：強烈建議在生產環境中設定 `ADMIN_PASSWORD` 加密 Secret，這將同時啟用網頁門禁與後端 AES-GCM 零知識加密儲存。
2. **Cloudflare Zero Trust / Cloudflare Access (雙重保障)**：
   對於極高安全要求的用戶，除了設定 `ADMIN_PASSWORD`，還可以依據上方的 **Zero Trust 教學** 為專案網域設定一條 Access 存取策略，限定僅允許您信任的電子郵件才能存取本 WebSSH 頁面。

````

## File: src/ssh.js
````js
import { Client } from 'ssh2';

export async function handleSSHUpgrade(request, env, config, isAuthEnabled, adminPassword, deriveKey, decryptText) {
  // 解密全部連線主機配置
  let finalHost = config.host || '';
  let finalPort = config.port || 22;
  let finalUsername = config.username || '';
  let finalPassword = config.password || '';
  let finalPrivateKey = config.privateKey || '';
  
  if (isAuthEnabled) {
    try {
      const aesKey = await deriveKey(adminPassword);
      finalHost = await decryptText(config.host, aesKey);
      const decPortStr = await decryptText(config.port, aesKey);
      finalPort = parseInt(decPortStr) || 22;
      finalUsername = await decryptText(config.username, aesKey);
      finalPassword = await decryptText(config.password, aesKey);
      finalPrivateKey = await decryptText(config.privateKey, aesKey);
    } catch (err) {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      server.send(`\r\n[CF-WebSSH 憑據解密錯誤]: ${err.message}\r\n`);
      server.close(1011);
      return new Response(null, { status: 101, webSocket: client });
    }
  }

  const [client, server] = Object.values(new WebSocketPair());
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
    finish([finalPassword]);
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
      host: finalHost,
      port: finalPort,
      username: finalUsername,
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

    if (finalPrivateKey) {
      connectOptions.privateKey = finalPrivateKey;
    } else {
      connectOptions.password = finalPassword;
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

````

## File: src/index.js
````js
import htmlContent from '../public/index.html';
import appJs from 'client-js:../public/app.js'; // 透過自訂 esbuild 插件，靜態解耦載入前端核心
import { deriveKey, encryptText, decryptText, hashPassword, getExpectedToken } from './crypto.js';
import { handleSSHUpgrade } from './ssh.js';
import { handleSFTPUpgrade } from './sftp.js';

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

    // 安全防禦門禁
    const publicPaths = ['/', '/index.html', '/app.js', '/api/login', '/api/auth-check', '/api/logout'];
    if (!publicPaths.includes(url.pathname)) {
      if (!(await isAuthorized())) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    // 1. 靜態網頁分發
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 1.1 靜態分離後的前端 JavaScript 分發
    if (url.pathname === '/app.js') {
      return new Response(appJs, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
      });
    }

    // 1.2 API: 檢查當前驗證狀態
    if (url.pathname === '/api/auth-check' && request.method === 'GET') {
      const authorized = await isAuthorized();
      return new Response(JSON.stringify({
        required: isAuthEnabled,
        authenticated: authorized
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1.3 API: 登入驗證
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

    // 1.4 API: 登出
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/javascript',
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
        let connections = [];

        let aesKey = null;
        if (isAuthEnabled) {
          aesKey = await deriveKey(adminPassword);
        }

        for (const val of values) {
          if (val) {
            const data = JSON.parse(val);
            
            let decName = data.name || '';
            let decHost = data.host || '';
            let decPort = data.port || 22;
            let decUsername = data.username || '';
            let hasPrivateKey = false;

            if (isAuthEnabled && aesKey) {
              try {
                decName = await decryptText(data.name, aesKey);
                decHost = await decryptText(data.host, aesKey);
                const decPortStr = await decryptText(data.port, aesKey);
                decPort = parseInt(decPortStr) || 22;
                decUsername = await decryptText(data.username, aesKey);
                
                const decPrivateKey = await decryptText(data.privateKey, aesKey);
                hasPrivateKey = typeof decPrivateKey === 'string' && decPrivateKey.length > 0;
              } catch (err) {
                decName = data.name || '';
                decHost = data.host || '';
                decPort = parseInt(data.port) || 22;
                decUsername = data.username || '';
                hasPrivateKey = typeof data.privateKey === 'string' && data.privateKey.length > 0;
              }
            } else {
              hasPrivateKey = typeof data.privateKey === 'string' && data.privateKey.length > 0;
            }

            connections.push({
              id: data.id,
              name: decName,
              host: decHost,
              port: decPort,
              username: decUsername,
              authType: hasPrivateKey ? 'key' : 'password',
            });
          }
        }

        // 自訂排序清單
        const orderVal = await env.WEBSSH_KV.get('connections_order');
        if (orderVal) {
          try {
            const orderArray = JSON.parse(orderVal);
            connections.sort((a, b) => {
              let idxA = orderArray.indexOf(a.id);
              let idxB = orderArray.indexOf(b.id);
              if (idxA === -1) idxA = 99999;
              if (idxB === -1) idxB = 99999;
              return idxA - idxB;
            });
          } catch (_) {}
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

        let aesKey = null;
        if (isAuthEnabled) {
          aesKey = await deriveKey(adminPassword);
        }

        const existingVal = await env.WEBSSH_KV.get(`connection:${id}`);
        let existingPlaintext = { name: '', host: '', port: 22, username: '', password: '', privateKey: '' };
        if (existingVal) {
          try {
            const existingData = JSON.parse(existingVal);
            if (isAuthEnabled && aesKey) {
              existingPlaintext.name = await decryptText(existingData.name, aesKey);
              existingPlaintext.host = await decryptText(existingData.host, aesKey);
              const decPortStr = await decryptText(existingData.port, aesKey);
              existingPlaintext.port = parseInt(decPortStr) || 22;
              existingPlaintext.username = await decryptText(existingData.username, aesKey);
              existingPlaintext.password = await decryptText(existingData.password, aesKey);
              existingPlaintext.privateKey = await decryptText(existingData.privateKey, aesKey);
            } else {
              existingPlaintext.name = existingData.name || '';
              existingPlaintext.host = existingData.host || '';
              existingPlaintext.port = parseInt(existingData.port) || 22;
              existingPlaintext.username = existingData.username || '';
              existingPlaintext.password = existingData.password || '';
              existingPlaintext.privateKey = existingData.privateKey || '';
            }
          } catch (_) {
            try {
              const existingData = JSON.parse(existingVal);
              existingPlaintext.name = existingData.name || '';
              existingPlaintext.host = existingData.host || '';
              existingPlaintext.port = parseInt(existingData.port) || 22;
              existingPlaintext.username = existingData.username || '';
              existingPlaintext.password = existingData.password || '';
              existingPlaintext.privateKey = existingData.privateKey || '';
            } catch (__) {}
          }
        }

        const finalName = data.name !== undefined ? data.name : existingPlaintext.name;
        const finalHost = data.host !== undefined ? data.host : existingPlaintext.host;
        const finalPort = data.port !== undefined ? parseInt(data.port) : existingPlaintext.port;
        const finalUsername = data.username !== undefined ? data.username : existingPlaintext.username;
        const finalPassword = data.password !== undefined ? data.password : existingPlaintext.password;
        const finalPrivateKey = data.privateKey !== undefined ? data.privateKey : existingPlaintext.privateKey;

        let storedName = finalName;
        let storedHost = finalHost;
        let storedPort = String(finalPort);
        let storedUsername = finalUsername;
        let storedPassword = finalPassword;
        let storedPrivateKey = finalPrivateKey;

        if (isAuthEnabled && aesKey) {
          storedName = await encryptText(finalName, aesKey);
          storedHost = await encryptText(finalHost, aesKey);
          storedPort = await encryptText(String(finalPort), aesKey);
          storedUsername = await encryptText(finalUsername, aesKey);
          storedPassword = await encryptText(finalPassword, aesKey);
          storedPrivateKey = await encryptText(finalPrivateKey, aesKey);
        }

        const connectionData = {
          id,
          name: storedName,
          host: storedHost,
          port: storedPort,
          username: storedUsername,
          password: storedPassword,
          privateKey: storedPrivateKey,
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

    // 3.5 API: 更新自訂排序清單
    if (url.pathname === '/api/connections/order' && request.method === 'POST') {
      try {
        const { order } = await request.json();
        if (Array.isArray(order)) {
          await env.WEBSSH_KV.put('connections_order', JSON.stringify(order));
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ error: '無效的排序格式' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 3.6 API: 獲取常用腳本列表
    if (url.pathname === '/api/scripts' && request.method === 'GET') {
      try {
        const list = await env.WEBSSH_KV.list({ prefix: 'script:' });
        const keys = list.keys;
        const values = await Promise.all(keys.map(key => env.WEBSSH_KV.get(key.name)));
        const scripts = [];

        let aesKey = null;
        if (isAuthEnabled) {
          aesKey = await deriveKey(adminPassword);
        }

        for (const val of values) {
          if (val) {
            const data = JSON.parse(val);
            let decName = data.name || '';
            let decContent = data.content || '';

            if (isAuthEnabled && aesKey) {
              try {
                decName = await decryptText(data.name, aesKey);
                decContent = await decryptText(data.content, aesKey);
              } catch (_) {
                decName = data.name || '';
                decContent = data.content || '';
              }
            }

            scripts.push({ id: data.id, name: decName, content: decContent });
          }
        }
        return new Response(JSON.stringify(scripts), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 3.7 API: 儲存常用腳本
    if (url.pathname === '/api/scripts' && request.method === 'POST') {
      try {
        const data = await request.json();
        if (!data.name || !data.content) {
          return new Response(JSON.stringify({ error: '缺少必要欄位' }), { status: 400 });
        }
        const id = data.id || crypto.randomUUID();

        const scriptData = {
          id,
          name: data.name,
          content: data.content
        };
        await env.WEBSSH_KV.put(`script:${id}`, JSON.stringify(scriptData));
        return new Response(JSON.stringify({ success: true, id }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 3.8 API: 刪除常用腳本
    if (url.pathname.startsWith('/api/scripts/') && request.method === 'DELETE') {
      try {
        const id = url.pathname.split('/').pop();
        await env.WEBSSH_KV.delete(`script:${id}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
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

    // 5. WebSocket: SSH 終端通道 (路由至獨立處理模組)
    if (url.pathname.startsWith('/ssh/') && request.headers.get('Upgrade') === 'websocket') {
      const id = url.pathname.split('/').pop();
      const connectionVal = await env.WEBSSH_KV.get(`connection:${id}`);
      if (!connectionVal) return new Response('連線配置不存在', { status: 404 });
      const config = JSON.parse(connectionVal);

      return handleSSHUpgrade(request, env, config, isAuthEnabled, adminPassword, deriveKey, decryptText);
    }

    // 6. WebSocket: SFTP 全功能通道 (路由至獨立處理模組)
    if (url.pathname.startsWith('/sftp/') && request.headers.get('Upgrade') === 'websocket') {
      const id = url.pathname.split('/').pop();
      const connectionVal = await env.WEBSSH_KV.get(`connection:${id}`);
      if (!connectionVal) return new Response('連線配置不存在', { status: 404 });
      const config = JSON.parse(connectionVal);

      return handleSFTPUpgrade(request, env, config, isAuthEnabled, adminPassword, deriveKey, decryptText);
    }

    return new Response('Not Found', { status: 404 });
  },
};

````

## File: src/sftp.js
````js
import { Client } from 'ssh2';

export async function handleSFTPUpgrade(request, env, config, isAuthEnabled, adminPassword, deriveKey, decryptText) {
  // 解密全部連線主機配置
  let finalHost = config.host || '';
  let finalPort = config.port || 22;
  let finalUsername = config.username || '';
  let finalPassword = config.password || '';
  let finalPrivateKey = config.privateKey || '';
  
  if (isAuthEnabled) {
    try {
      const aesKey = await deriveKey(adminPassword);
      finalHost = await decryptText(config.host, aesKey);
      const decPortStr = await decryptText(config.port, aesKey);
      finalPort = parseInt(decPortStr) || 22;
      finalUsername = await decryptText(config.username, aesKey);
      finalPassword = await decryptText(config.password, aesKey);
      finalPrivateKey = await decryptText(config.privateKey, aesKey);
    } catch (err) {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      server.send(JSON.stringify({ status: 'error', message: `憑據解密失敗: ${err.message}` }));
      server.close(1011);
      return new Response(null, { status: 101, webSocket: client });
    }
  }

  const [client, server] = Object.values(new WebSocketPair());
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
      server.send(JSON.stringify({ status: 'ready' }));
    });
  });

  sshClient.on('error', (err) => {
    server.send(JSON.stringify({ error: `SSH 連線錯誤: ${err.message}` }));
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

      if (!sftpClient) {
        server.send(JSON.stringify({ status: 'error', message: '遠端 SSH/SFTP 連線仍在建立中，請稍候。' }));
        return;
      }

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

      else if (msg.action === 'upload_start') {
        uploadStream = sftpClient.createWriteStream(msg.path, { flags: 'w', mode: 0o644 });
        uploadStream.on('error', (err) => {
          server.send(JSON.stringify({ status: 'error', message: `開啟遠端寫入串流出錯: ${err.message}` }));
        });
        server.send(JSON.stringify({ status: 'upload_ready' }));
      }

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

      else if (msg.action === 'upload_cancel') {
        if (uploadStream) {
          uploadStream.end(() => {
            uploadStream = null;
          });
        }
      }

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

      else if (msg.action === 'download_next') {
        if (downloadStream) {
          downloadStream.resume();
        }
      }

      else if (msg.action === 'file_read') {
        sftpClient.readFile(msg.path, 'utf8', (err, data) => {
          if (err) {
            server.send(JSON.stringify({ status: 'error', message: `讀取遠端檔案失敗: ${err.message}` }));
            return;
          }
          server.send(JSON.stringify({ status: 'file_read_ok', path: msg.path, content: data }));
        });
      }

      else if (msg.action === 'file_write') {
        sftpClient.writeFile(msg.path, msg.content, 'utf8', (err) => {
          if (err) {
            server.send(JSON.stringify({ status: 'error', message: `寫入遠端檔案失敗: ${err.message}` }));
            return;
          }
          server.send(JSON.stringify({ status: 'file_write_ok', path: msg.path }));
        });
      }

    } catch (e) {
      server.send(JSON.stringify({ status: 'error', message: `SFTP 協定解析錯誤: ${e.message}` }));
    }
  });

  try {
    const connectOptions = {
      host: finalHost,
      port: finalPort,
      username: finalUsername,
      readyTimeout: 30000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      tryKeyboard: true,
      algorithms: {
        kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group14-sha256', 'diffie-hellman-group16-sha512', 'diffie-hellman-group-exchange-sha256'],
        cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-cbc', 'aes192-cbc', 'aes256-cbc']
      }
    };

    if (finalPrivateKey) {
      connectOptions.privateKey = finalPrivateKey;
    } else {
      connectOptions.password = finalPassword;
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

````

## File: src/crypto.js
````js
// 堆疊安全的 ArrayBuffer 轉 Base64 函數 (防範大檔案私鑰溢位)
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 堆疊安全的 Base64 轉 ArrayBuffer 函數
export function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// 根據管理密碼衍生對稱加密金鑰 (AES-GCM 256-bit)
export async function deriveKey(adminPassword) {
  const passwordBytes = new TextEncoder().encode(adminPassword);
  const hash = await crypto.subtle.digest('SHA-256', passwordBytes);
  return await crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// 加密明文字串
export async function encryptText(text, key) {
  if (text === undefined || text === null) return '';
  const str = String(text);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 12-byte IV 適用於 GCM
  const encoded = new TextEncoder().encode(str);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  const ivB64 = arrayBufferToBase64(iv);
  const cipherB64 = arrayBufferToBase64(ciphertext);
  return `${ivB64}:${cipherB64}`;
}

// 解密字串 (支援對舊明文數值/字串的向下相容)
export async function decryptText(encryptedStr, key) {
  if (encryptedStr === undefined || encryptedStr === null) return '';
  const str = String(encryptedStr);
  const parts = str.split(':');
  if (parts.length !== 2) {
    return str;
  }
  try {
    const [ivB64, cipherB64] = parts;
    const iv = new Uint8Array(base64ToArrayBuffer(ivB64));
    const ciphertext = base64ToArrayBuffer(cipherB64);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error("安全解密失敗:", err);
    throw new Error("憑據解密失敗。");
  }
}

// 使用 WebCrypto 計算 SHA-256 雜湊值（用於登入 Session Token 簽章）
export async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 根據環境變數中的密碼加鹽計算預期 Token
export async function getExpectedToken(adminPassword) {
  return await hashPassword(adminPassword + "cf-webssh-salt-2026");
}

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
        <!-- 腳本管理按鈕 -->
        <button onclick="showScriptsModal()" class="bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 px-4 py-2 rounded font-medium transition text-sm">
          📜 常用腳本
        </button>
        <button onclick="showAddModal()" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-medium transition text-sm">
          新增伺服器
        </button>
      </div>
    </header>

    <!-- 伺服器列表 -->
    <main>
      <div id="connections-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <!-- 動態渲染清單 (支援拖拽排序) -->
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

  <!-- 常用腳本管理 Modal -->
  <div id="scripts-modal" class="fixed inset-0 bg-black/80 hidden items-center justify-center p-4 z-40">
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
      <div class="pb-3 border-b border-slate-800 flex justify-between items-center bg-slate-900">
        <h2 class="text-xl font-bold text-emerald-400">📜 常用腳本管理</h2>
        <button onclick="hideScriptsModal()" class="text-slate-400 hover:text-white text-sm font-bold p-1">
          關閉 ✕
        </button>
      </div>
      
      <!-- SSH 密鑰生成器 -->
      <div class="py-4 border-b border-slate-800">
        <div class="flex justify-between items-center mb-3">
          <h3 class="text-sm font-bold text-slate-300">🔑 內建安全 SSH 密鑰生成器</h3>
          <button onclick="generateSshKey()" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded text-xs font-semibold transition">
            一鍵生成 ED25519 密鑰對
          </button>
        </div>
        <div id="key-gen-result" class="hidden space-y-3 mt-3">
          <div>
            <div class="flex justify-between items-center mb-1">
              <label class="text-[10px] text-slate-400">公鑰 (Public Key) - 請追加至遠端 VPS <code>~/.ssh/authorized_keys</code></label>
              <button onclick="copyToClipboard('keygen-pubkey')" class="text-[10px] text-emerald-400 hover:underline font-bold">複製</button>
            </div>
            <textarea id="keygen-pubkey" readonly rows="2" class="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-[10px] font-mono text-slate-300 select-all focus:outline-none"></textarea>
          </div>
          <div>
            <div class="flex justify-between items-center mb-1">
              <label class="text-[10px] text-slate-400">私鑰 (Private Key - PEM 格式) - 請妥善儲存或直接用於主機連線配置</label>
              <button onclick="copyToClipboard('keygen-privkey')" class="text-[10px] text-emerald-400 hover:underline font-bold">複製</button>
            </div>
            <textarea id="keygen-privkey" readonly rows="4" class="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-[9px] font-mono text-slate-300 select-all focus:outline-none"></textarea>
          </div>
        </div>
      </div>

      <!-- 新增腳本表單 -->
      <form id="script-form" onsubmit="saveScript(event)" class="py-4 border-b border-slate-800 space-y-3">
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-1">
            <input type="text" id="script-name" required placeholder="腳本名稱 (如: 更新)" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500">
          </div>
          <div class="col-span-2">
            <input type="text" id="script-content" required placeholder="指令內容 (如: apt update)" class="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500">
          </div>
        </div>
        <div class="flex justify-end">
          <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-semibold transition">
            + 新增腳本
          </button>
        </div>
      </form>

      <!-- 腳本列表區 -->
      <div id="scripts-list" class="flex-1 overflow-y-auto pt-4 space-y-2 text-xs">
        <!-- 動態渲染常用腳本清單 -->
      </div>
    </div>
  </div>

  <!-- 終端機全螢幕容器 (z-50) -->
  <div id="terminal-screen" class="fixed inset-0 bg-black hidden flex-col z-50">
    <!-- 頂部資訊與控制欄 -->
    <div class="bg-slate-900 px-4 py-2 flex justify-between items-center border-b border-slate-800 text-sm">
      <div class="flex items-center space-x-3 flex-wrap gap-y-2">
        <span id="active-terminal-title" class="font-mono text-slate-300">連線中...</span>
        
        <span class="text-slate-700 hidden md:inline">|</span>
        <!-- 檔案瀏覽器彈窗切換主按鈕 -->
        <button onclick="toggleSftpModal()" class="text-xs bg-slate-800 hover:bg-slate-700 hover:text-emerald-300 text-emerald-400 border border-slate-700 px-2.5 py-1 rounded font-medium transition flex items-center gap-1.5">
          📁 SFTP 檔案管理
        </button>

        <!-- 常用腳本快速選單 -->
        <select id="terminal-script-select" onchange="runSelectedScript(this)" class="bg-slate-800 text-emerald-400 border border-slate-700 rounded px-2 py-1 text-xs font-medium focus:outline-none focus:border-emerald-500">
          <option value="" disabled selected>📜 常用腳本...</option>
          <!-- 動態渲染常用腳本選項 -->
        </select>

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

  <!-- SFTP 檔案管理器中央彈窗 Modal (z-[60]) -->
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
        <!-- 整合至檔案管理器內的手動上傳按鈕 -->
        <button onclick="triggerFileInput()" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded font-semibold transition flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
          </svg>
          上傳檔案
        </button>
      </div>

      <!-- 目前目錄路徑顯示欄（改為「類 WINDOWS」互動式麵包屑導航條） -->
      <div class="p-2 border-b border-slate-800 bg-slate-950 flex items-center gap-1">
        <span class="text-xs text-slate-500 font-mono pr-1 select-none">路徑:</span>
        <div id="sftp-breadcrumbs" class="flex-1 flex items-center flex-wrap gap-1 text-[11px] font-mono select-none">
          <!-- 麵包屑節點將由 JavaScript 動態生成 -->
        </div>
      </div>

      <!-- 檔案與資料夾清單區 -->
      <div id="sftp-file-list" class="flex-1 overflow-y-auto p-4 space-y-1.5 text-xs font-mono select-none">
        <!-- 動態渲染清單 -->
      </div>
    </div>
  </div>

  <!-- SFTP 遠端線上檔案編輯器 Modal (z-[70] 覆蓋於 SFTP 彈窗之上) -->
  <div id="editor-modal" class="fixed inset-0 bg-black/85 hidden items-center justify-center p-4 z-[70]">
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in">
      
      <!-- 編輯器標題 -->
      <div class="pb-3 border-b border-slate-800 flex justify-between items-center bg-slate-900">
        <h3 id="editor-file-title" class="font-bold text-amber-400 text-sm font-mono truncate max-w-[80%]">
          📝 編輯遠端檔案
        </h3>
        <button onclick="closeFileEditor()" class="text-slate-400 hover:text-white text-xs">
          取消 ✕
        </button>
      </div>
      
      <!-- 編輯內容文字區域 -->
      <textarea id="editor-textarea" class="flex-1 w-full bg-slate-950 border border-slate-800 rounded p-4 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500 resize-none mt-4 whitespace-pre overflow-auto leading-relaxed" spellcheck="false"></textarea>
      
      <!-- 操作按鈕列 -->
      <div class="mt-4 flex justify-end space-x-3">
        <button onclick="closeFileEditor()" class="px-4 py-2 border border-slate-800 rounded hover:bg-slate-800 text-xs transition">
          取消
        </button>
        <button onclick="saveRemoteFile()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs font-semibold transition flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path>
          </svg>
          儲存變更
        </button>
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

  <!-- 引入解耦的前端核心控制程式腳本 (由後端動態提供) -->
  <script src="/app.js"></script>
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
// 在最頂端加入 // @ts-nocheck 即可讓 Cloudflare 網頁編輯器完全關閉型別檢驗與紅字報錯 (修改處)
const bannerJs = `// @ts-nocheck
import { createRequire } from 'node:module';
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

