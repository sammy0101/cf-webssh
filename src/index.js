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

    // 4.1 API: SFTP 取得檔案列表 (新增)
    if (url.pathname === '/api/sftp/list' && request.method === 'GET') {
      try {
        const connId = url.searchParams.get('id');
        const path = url.searchParams.get('path') || '.';
        const connectionVal = await env.WEBSSH_KV.get(`connection:${connId}`);
        if (!connectionVal) return new Response('Not Found', { status: 404 });
        const config = JSON.parse(connectionVal);

        return new Promise((resolve) => {
          const sshClient = new Client();
          sshClient.on('ready', () => {
            sshClient.sftp((err, sftp) => {
              if (err) {
                sshClient.end();
                return resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
              }
              // 解析絕對路徑以確保導航與麵包屑的一致性
              sftp.realpath(path, (err, absPath) => {
                const targetPath = err ? path : absPath;
                sftp.readdir(targetPath, (err, list) => {
                  sshClient.end();
                  if (err) {
                    return resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
                  }
                  
                  const files = list.map(item => {
                    return {
                      name: item.filename,
                      size: item.attrs.size,
                      isDir: item.attrs.isDirectory(),
                      modifyTime: item.attrs.mtime
                    };
                  }).sort((a, b) => {
                    // 資料夾排在最前面，隨後按名稱排序
                    if (a.isDir && !b.isDir) return -1;
                    if (!a.isDir && b.isDir) return 1;
                    return a.name.localeCompare(b.name);
                  });

                  return resolve(new Response(JSON.stringify({ path: targetPath, files }), {
                    headers: { 'Content-Type': 'application/json' }
                  }));
                });
              });
            });
          });
          sshClient.on('error', (err) => {
            resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
          });

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
          if (config.privateKey) connectOptions.privateKey = config.privateKey;
          else connectOptions.password = config.password;
          sshClient.connect(connectOptions);
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 4.2 API: SFTP 檔案串流下載 (新增)
    if (url.pathname === '/api/sftp/download' && request.method === 'GET') {
      try {
        const connId = url.searchParams.get('id');
        const path = url.searchParams.get('path');
        const connectionVal = await env.WEBSSH_KV.get(`connection:${connId}`);
        if (!connectionVal) return new Response('Not Found', { status: 404 });
        const config = JSON.parse(connectionVal);

        return new Promise((resolve) => {
          const sshClient = new Client();
          sshClient.on('ready', () => {
            sshClient.sftp((err, sftp) => {
              if (err) {
                sshClient.end();
                return resolve(new Response('SFTP Error', { status: 500 }));
              }

              const filename = path.split('/').pop() || 'download';
              const nodeStream = sftp.createReadStream(path);
              
              // 當串流完成、關閉或報錯時，關閉底層 SSH 連線
              const cleanup = () => sshClient.end();
              nodeStream.on('close', cleanup);
              nodeStream.on('error', cleanup);

              // 轉換為 Web ReadableStream 返回，節省 Worker 記憶體
              const webStream = Readable.toWeb(nodeStream);
              return resolve(new Response(webStream, {
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
                }
              }));
            });
          });
          sshClient.on('error', () => {
            resolve(new Response('SSH Error', { status: 500 }));
          });

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
          if (config.privateKey) connectOptions.privateKey = config.privateKey;
          else connectOptions.password = config.password;
          sshClient.connect(connectOptions);
        });
      } catch (err) {
        return new Response(err.message, { status: 500 });
      }
    }

    // 4.3 API: SFTP 刪除檔案或資料夾 (新增)
    if (url.pathname === '/api/sftp/delete' && request.method === 'POST') {
      try {
        const { id: connId, path, isDir } = await request.json();
        const connectionVal = await env.WEBSSH_KV.get(`connection:${connId}`);
        if (!connectionVal) return new Response('Not Found', { status: 404 });
        const config = JSON.parse(connectionVal);

        return new Promise((resolve) => {
          const sshClient = new Client();
          sshClient.on('ready', () => {
            sshClient.sftp((err, sftp) => {
              if (err) {
                sshClient.end();
                return resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
              }

              const callback = (err) => {
                sshClient.end();
                if (err) return resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
                return resolve(new Response(JSON.stringify({ success: true }), {
                  headers: { 'Content-Type': 'application/json' }
                }));
              };

              if (isDir) {
                sftp.rmdir(path, callback);
              } else {
                sftp.unlink(path, callback);
              }
            });
          });
          sshClient.on('error', (err) => {
            resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
          });

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
          if (config.privateKey) connectOptions.privateKey = config.privateKey;
          else connectOptions.password = config.password;
          sshClient.connect(connectOptions);
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
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

    // 6. WebSocket 協議轉換為 TCP SFTP 檔案傳輸橋接
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
          server.send(JSON.stringify({ status: 'ready' }));
        });
      });

      sshClient.on('error', (err) => {
        server.send(JSON.stringify({ error: `SSH 連線錯誤: ${err.message}` }));
        server.close(1011);
      });

      server.addEventListener('message', async (event) => {
        if (event.data instanceof ArrayBuffer) {
          if (sftpStream) {
            const chunk = new Uint8Array(event.data);
            sftpStream.write(chunk, (err) => {
              if (err) {
                server.send(JSON.stringify({ error: `寫入遠端檔案失敗: ${err.message}` }));
                server.close(1011);
                return;
              }
              server.send(JSON.stringify({ status: 'ack', written: chunk.length }));
            });
          } else {
            server.send(JSON.stringify({ error: '寫入串流尚未建立' }));
          }
          return;
        }

        try {
          const msg = JSON.parse(event.data);
          if (msg.action === 'upload') {
            const remotePath = `./${msg.filename}`;
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
