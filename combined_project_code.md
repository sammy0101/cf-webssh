# Complete Project Codebase
Generated on: Tue Jun 23 17:55:18 UTC 2026

## File: README.md
````md
# cf-webssh
````

## File: src/index.js
````js
import { Client } from 'ssh2';
import htmlContent from '../public/index.html';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 靜態網頁派發
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 2. API: 獲取已儲存的連線列表 (不返回敏感的密碼與私鑰，但標記其認證類型)
    if (url.pathname === '/api/connections' && request.method === 'GET') {
      try {
        const list = await env.WEBSSH_KV.list({ prefix: 'connection:' });
        const keys = list.keys;
        
        // 使用 Promise.all 併發讀取，優化效能
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
              authType: data.privateKey ? 'key' : 'password', // 用於前端判斷認證模式
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

    // 3. API: 新增/更新連線資訊 (支援局部更新保留舊密碼/私鑰)
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

        // 讀取現有配置進行安全合併
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
          // 若沒傳入相關敏感欄位，則保留原本保存在 KV 的密碼/私鑰
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

    // 5. WebSocket 協議轉換為 TCP SSH 橋接
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
      let pendingResize = null; // 用來存取在 Stream 尚未就緒時前端發送的縮放設定

      sshClient.on('ready', () => {
        server.send('\r\n[SSH] 已連線，正在啟動終端...\r\n');
        
        // 使用前端已發送的視窗大小，或預設 80x24
        const initialCols = pendingResize ? pendingResize.cols : 80;
        const initialRows = pendingResize ? pendingResize.rows : 24;

        // 使用互動式 shell 建立終端連線
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

      // 監聽前端 WebSocket 訊息
      server.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'resize') {
            if (sshStream) {
              sshStream.setWindow(msg.rows, msg.cols);
            } else {
              // 終端未啟動時，先儲存視窗縮放設定
              pendingResize = { rows: msg.rows, cols: msg.cols };
            }
          } else if (msg.type === 'data' && sshStream) {
            sshStream.write(msg.data);
          }
        } catch (e) {
          // 相容寫入原始字串資料
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
            // 1. 設定金鑰交換演算法，主動排除 curve25519 
            kex: [
              'ecdh-sha2-nistp256',
              'ecdh-sha2-nistp384',
              'ecdh-sha2-nistp521',
              'diffie-hellman-group14-sha256',
              'diffie-hellman-group16-sha512',
              'diffie-hellman-group-exchange-sha256'
            ],
            // 2. 限制對稱加密演算法，排除 AEAD 模式 (chacha20-poly1305, aes-gcm)，避免 workerd 串流解密相容性問題
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

        // 開始建立 SSH 連線
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

    return new Response('Not Found', { status: 404 });
  },
};

````

## File: wrangler.toml
````toml
name = "cf-webssh"
main = "dist/index.js"
# 升級相容性日期至 2026-01-01，以原生啟用 node:fs 與其他現代 Node.js 模組
compatibility_date = "2026-01-01"
compatibility_flags = [ "nodejs_compat" ]

[[kv_namespaces]]
binding = "WEBSSH_KV"
id = "KV_NAMESPACE_ID_PLACEHOLDER"

````

## File: public/index.html
````html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare WebSSH 工作台</title>
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
      <h1 class="text-2xl font-bold tracking-wider text-emerald-400">⚡ CF-WebSSH</h1>
      <button onclick="showAddModal()" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-medium transition">
        新增伺服器
      </button>
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

    // 初始化載入
    document.addEventListener("DOMContentLoaded", fetchConnections);

    async function fetchConnections() {
      try {
        const res = await fetch('/api/connections');
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
      // 提醒使用者如果不修改密碼/私鑰，可維持留白
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
          body.privateKey = ''; // 若切換成密碼驗證，清空私鑰
        }
      } else {
        const privateKeyVal = document.getElementById('conn-privatekey').value;
        if (privateKeyVal || !id) {
          body.privateKey = privateKeyVal;
          body.password = ''; // 若切換成私鑰驗證，清空密碼
        }
      }

      await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      hideModal();
      fetchConnections();
    }

    async function deleteConnection(id) {
      if (confirm('確定要刪除此伺服器連線配置嗎？')) {
        await fetch(`/api/connections/${id}`, { method: 'DELETE' });
        fetchConnections();
      }
    }

    // 連線至 SSH
    function connectSSH(id, name) {
      document.getElementById('active-terminal-title').textContent = `連線至: ${name}`;
      document.getElementById('terminal-screen').classList.remove('hidden');
      document.getElementById('terminal-screen').classList.add('flex');

      // 初始化 xterm.js
      term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Courier New, Courier, monospace',
        fontSize: 14,
        theme: {
          background: '#020617', // Slate-950
          foreground: '#f8fafc',
          cursor: '#10b981'
        }
      });

      fitAddon = new window.FitAddon.FitAddon(); // 引入適應外層組件
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal-container'));
      fitAddon.fit();
      
      // 自動將焦點鎖定至終端機，免去滑鼠點擊
      term.focus();

      // 建立 WebSocket 通訊
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      const wsUrl = `${protocol}${window.location.host}/ssh/${id}`;
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer'; // 確保解析二進位數據正常

      ws.onopen = () => {
        term.write('\r\n[CF-WebSSH]: 已成功建立通訊隧道，正在連線遠端伺服器...\r\n');
        // 發送初始視窗維度
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

      // 處理鍵盤輸入發送
      term.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data: data }));
        }
      });

      // 監聽瀏覽器視窗大小調整
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

