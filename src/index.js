import { Client } from 'ssh2';
import htmlContent from '../public/index.html';

// ==========================================
// 🔐 安全對稱加密輔助函數 (AES-GCM-256)
// ==========================================

// 堆疊安全的 ArrayBuffer 轉 Base64 函數 (防範大檔案私鑰溢位)
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 堆疊安全的 Base64 轉 ArrayBuffer 函數
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// 根據管理密碼衍生對稱加密金鑰 (AES-GCM 256-bit)
async function deriveKey(adminPassword) {
  const passwordBytes = new TextEncoder().encode(adminPassword);
  // 將密碼雜湊為 256 位元位元組
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
async function encryptText(text, key) {
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
  return `${ivB64}:${cipherB64}`; // 拼接儲存為 IV:密文 格式
}

// 解密字串 (具備極強的防禦性防護與對舊明文數值/字串的向下相容)
async function decryptText(encryptedStr, key) {
  if (encryptedStr === undefined || encryptedStr === null) return '';
  // 轉為字串處理以防範數值型欄位（如未加密時的舊 port 數值）
  const str = String(encryptedStr);
  const parts = str.split(':');
  // 降級相容：如果沒有 ":" 冒號分隔符，代表是未加密的舊明文，直接返回
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
    throw new Error("憑據解密失敗。可能管理密碼已變更，或檔案在庫中損壞。");
  }
}

// 使用 WebCrypto 計算 SHA-256 雜湊值（用於登入 Session Token 簽章）
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

    // 2. API: 獲取已儲存的連線列表 (讀取時即時 AES 解密還原明文供前端使用)
    if (url.pathname === '/api/connections' && request.method === 'GET') {
      try {
        const list = await env.WEBSSH_KV.list({ prefix: 'connection:' });
        const keys = list.keys;
        const values = await Promise.all(keys.map(key => env.WEBSSH_KV.get(key.name)));
        const connections = [];

        // 準備對稱解密金鑰
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
                // 解密失敗則安全相容地退回原明文 (相容舊有未加密連線)
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

    // 3. API: 新增/更新連線資訊 (儲存時將全部資訊：主機、名稱、端口、使用者名稱、密碼與私鑰全數進行高強度 AES 加密)
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

        // 1. 取得金鑰衍生變數
        let aesKey = null;
        if (isAuthEnabled) {
          aesKey = await deriveKey(adminPassword);
        }

        // 2. 讀取並解密現有配置 (用於安全局部更新)
        const existingVal = await env.WEBSSH_KV.get(`connection:${id}`);
        let existingPlaintext = { name: '', host: '', port: 22, username: '', password: '', privateKey: '' };
        if (existingVal) {
          try {
            const existingData = JSON.parse(existingVal);
            if (isAuthEnabled && aesKey) {
              // 解密原先已儲存的所有欄位明文
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
            // 如果解密失敗（可能使用者剛剛才開啟安全模式），相容退回明文讀取
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

        // 3. 合併前端新傳入的明文與舊有的明文
        const finalName = data.name !== undefined ? data.name : existingPlaintext.name;
        const finalHost = data.host !== undefined ? data.host : existingPlaintext.host;
        const finalPort = data.port !== undefined ? parseInt(data.port) : existingPlaintext.port;
        const finalUsername = data.username !== undefined ? data.username : existingPlaintext.username;
        const finalPassword = data.password !== undefined ? data.password : existingPlaintext.password;
        const finalPrivateKey = data.privateKey !== undefined ? data.privateKey : existingPlaintext.privateKey;

        // 4. 若開啟了密碼保護，將連線設定所有欄位一併加密為 AES 密文
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

    // 5. WebSocket 協議轉換為 TCP SSH 終端橋接 (自動即時解密全量欄位)
    if (url.pathname.startsWith('/ssh/') && request.headers.get('Upgrade') === 'websocket') {
      const id = url.pathname.split('/').pop();
      const connectionVal = await env.WEBSSH_KV.get(`connection:${id}`);
      if (!connectionVal) {
        return new Response('連線配置不存在', { status: 404 });
      }

      const config = JSON.parse(connectionVal);
      
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

    // 6. WebSocket 單一通道 SFTP 全功能管理器 (自動即時解密全量欄位)
    if (url.pathname.startsWith('/sftp/') && request.headers.get('Upgrade') === 'websocket') {
      const id = url.pathname.split('/').pop();
      const connectionVal = await env.WEBSSH_KV.get(`connection:${id}`);
      if (!connectionVal) {
        return new Response('連線配置不存在', { status: 404 });
      }

      const config = JSON.parse(connectionVal);

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

    return new Response('Not Found', { status: 404 });
  },
};
