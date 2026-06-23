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

    // 2. API: 獲取已儲存的連線列表 (不返回敏感的密碼與私鑰)
    if (url.pathname === '/api/connections' && request.method === 'GET') {
      try {
        const list = await env.WEBSSH_KV.list({ prefix: 'connection:' });
        const connections = [];
        for (const key of list.keys) {
          const val = await env.WEBSSH_KV.get(key.name);
          if (val) {
            const data = JSON.parse(val);
            connections.push({
              id: data.id,
              name: data.name,
              host: data.host,
              port: data.port || 22,
              username: data.username,
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

    // 3. API: 新增/更新連線資訊 (儲存密碼或私鑰至 KV)
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
        const connectionData = {
          id,
          name: data.name,
          host: data.host,
          port: parseInt(data.port) || 22,
          username: data.username,
          password: data.password || '',
          privateKey: data.privateKey || '',
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

      sshClient.on('ready', () => {
        sshClient.shell((err, stream) => {
          if (err) {
            server.send(`\r\n[SSH Shell 啟動失敗]: ${err.message}\r\n`);
            server.close(1011);
            sshClient.end();
            return;
          }
          sshStream = stream;

          stream.on('data', (data) => {
            server.send(data);
          });

          stream.on('close', () => {
            server.close();
            sshClient.end();
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

      // 監聽前端 WebSocket 訊息
      server.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'resize' && sshStream) {
            // 控制終端視窗大小
            sshStream.setWindow(msg.rows, msg.cols);
          } else if (msg.type === 'data' && sshStream) {
            // 寫入終端指令
            sshStream.write(msg.data);
          }
        } catch (e) {
          // 若不為 JSON，相容寫入原始資料
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
          algorithms: {
            kex: [
              'ecdh-sha2-nistp256',
              'ecdh-sha2-nistp384',
              'ecdh-sha2-nistp521',
              'diffie-hellman-group14-sha256',
              'diffie-hellman-group14-sha1',
            ],
            hostKey: [
              'ssh-ed25519',
              'ecdsa-sha2-nistp256',
              'ecdsa-sha2-nistp384',
              'ecdsa-sha2-nistp521',
              'rsa-sha2-512',
              'rsa-sha2-256',
              'ssh-rsa',
            ],
            cipher: [
              'aes128-ctr',
              'aes192-ctr',
              'aes256-ctr',
              'aes128-cbc',
              'aes192-cbc',
              'aes256-cbc',
              '3des-cbc',
            ],
          },
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
