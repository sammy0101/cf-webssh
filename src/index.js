import htmlContent from '../public/index.html';
import appJs from 'client-js:../public/app.js'; 
import { deriveKey, encryptText, decryptText, hashPassword, getExpectedToken } from './crypto.js';
import { handleSSHUpgrade } from './ssh.js';
import { handleSFTPUpgrade } from './sftp.js';

// __APP_VERSION__ 會在編譯階段被 esbuild 動態替換為 package.json 的實體版本字串
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

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
      // 🆕 透過動態注入版本查詢字串（Cache Busting）強制瀏覽器立刻載入最新前端代碼，防止載入快取舊檔 (修改處)
      const parsedHtml = htmlContent.replace('/app.js', `/app.js?v=${APP_VERSION}`);
      return new Response(parsedHtml, {
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
        authenticated: authorized,
        version: APP_VERSION // 傳遞版本號給前端
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
