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
          // 移除 algorithms 設定，讓 ssh2 自動選擇兼容當前系統的最優演算法
        };

        if (config.privateKey) {
          connectOptions.privateKey = config.privateKey;
        } else {
          connectOptions.password = config.password;
        }

        // 開始建立 SSH 連線（底層將透過 nodejs_compat 自動轉換為 cloudflare:sockets 的 TCP 連線）
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
