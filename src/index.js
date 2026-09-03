import htmlContent from '../public/index.html';
import appJs from 'client-js:../public/app.js'; 
import vendorJs from 'vendor-js:client';
import vendorCss from 'vendor-css:client';
import { deriveKey, encryptText, decryptText, hashPassword, getExpectedToken, createQuickConnectToken, parseQuickConnectToken } from './crypto.js';
import { handleSSHUpgrade } from './ssh.js';
import { handleSFTPUpgrade } from './sftp.js';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

// 🛡️ T-2: 邊緣 IP 限流輔助函式
async function checkRateLimit(env, key, maxAttempts, decaySeconds) {
  if (!env.WEBSSH_KV) return { allowed: true };
  try {
    const current = await env.WEBSSH_KV.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= maxAttempts) {
      return { allowed: false, count };
    }
    await env.WEBSSH_KV.put(key, String(count + 1), { expirationTtl: decaySeconds });
    return { allowed: true, count: count + 1 };
  } catch (_) {
    return { allowed: true };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

    const adminPassword = env.ADMIN_PASSWORD;
    const isAuthEnabled = typeof adminPassword === 'string' && adminPassword.length > 0;

    const getCookie = (name) => {
      const value = `; ${request.headers.get('Cookie') || ''}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(';').shift();
      return null;
    };

    const isAuthorized = async () => {
      if (!isAuthEnabled) return true;
      const token = getCookie('webssh_token');
      if (!token) return false;
      const expected = await getExpectedToken(adminPassword);
      return token === expected;
    };

    // 公開路徑
    const publicPaths = [
      '/', '/index.html', '/app.js', '/vendor.js', '/vendor.css',
      '/api/login', '/api/auth-check', '/api/logout'
    ];
    if (!publicPaths.includes(url.pathname)) {
      if (!(await isAuthorized())) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    // 1. 靜態網頁與 Zero-CDN 資源交付
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const parsedHtml = htmlContent
        .replace('/app.js', `/app.js?v=${APP_VERSION}`)
        .replace('/vendor.js', `/vendor.js?v=${APP_VERSION}`)
        .replace('/vendor.css', `/vendor.css?v=${APP_VERSION}`);
      return new Response(parsedHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname === '/app.js') {
      return new Response(appJs, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
      });
    }

    // 🚀 T-5: 100% 邊緣交付 xterm 核心與 CSS
    if (url.pathname === '/vendor.js') {
      return new Response(vendorJs, {
        headers: { 
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=604800, immutable'
        },
      });
    }

    if (url.pathname === '/vendor.css') {
      return new Response(vendorCss, {
        headers: { 
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'public, max-age=604800, immutable'
        },
      });
    }

    // 1.2 API: 驗證狀態檢查
    if (url.pathname === '/api/auth-check' && request.method === 'GET') {
      const authorized = await isAuthorized();
      return new Response(JSON.stringify({
        required: isAuthEnabled,
        authenticated: authorized,
        version: APP_VERSION
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1.3 API: 登入驗證（🛡️ T-2: 加入暴力破解防護，5 次失敗封鎖 15 分鐘）
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try {
        const rlKey = `ratelimit:login:${clientIp}`;
        const rlCheck = await checkRateLimit(env, rlKey, 5, 900);
        if (!rlCheck.allowed) {
          return new Response(JSON.stringify({ error: '密碼錯誤次數過多，此 IP 已被暫時封鎖 15 分鐘' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const { password } = await request.json();
        if (isAuthEnabled && password === adminPassword) {
          if (env.WEBSSH_KV) await env.WEBSSH_KV.delete(rlKey);
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

    // 1.5 API: 快速連線憑據生成（🛡️ T-2: 每分鐘限制 15 次）
    if (url.pathname === '/api/quick-connect' && request.method === 'POST') {
      try {
        const rlKey = `ratelimit:quick:${clientIp}`;
        const rlCheck = await checkRateLimit(env, rlKey, 15, 60);
        if (!rlCheck.allowed) {
          return new Response(JSON.stringify({ error: '連線建立請求過於頻繁，請稍候重試' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const data = await request.json();
        if (!data.host || !data.username) {
          return new Response(JSON.stringify({ error: '缺少必要欄位' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const tempId = await createQuickConnectToken(data, adminPassword, isAuthEnabled);
        return new Response(JSON.stringify({ success: true, tempId }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 2. API: 伺服器連線列表
    if (url.pathname === '/api/connections' && request.method === 'GET') {
      try {
        const list = await env.WEBSSH_KV.list({ prefix: 'connection:' });
        const values = await Promise.all(list.keys.map(key => env.WEBSSH_KV.get(key.name)));
        let connections = [];

        let aesKey = null;
        if (isAuthEnabled) aesKey = await deriveKey(adminPassword);

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
                decPort = parseInt(await decryptText(data.port, aesKey)) || 22;
                decUsername = await decryptText(data.username, aesKey);
                const decPrivateKey = await decryptText(data.privateKey, aesKey);
                hasPrivateKey = typeof decPrivateKey === 'string' && decPrivateKey.length > 0;
              } catch (_) {
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

    // 3. API: 新增/更新連線
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
        if (isAuthEnabled) aesKey = await deriveKey(adminPassword);

        const existingVal = await env.WEBSSH_KV.get(`connection:${id}`);
        let existingPlaintext = { name: '', host: '', port: 22, username: '', password: '', privateKey: '' };
        if (existingVal) {
          try {
            const existingData = JSON.parse(existingVal);
            if (isAuthEnabled && aesKey) {
              existingPlaintext.name = await decryptText(existingData.name, aesKey);
              existingPlaintext.host = await decryptText(existingData.host, aesKey);
              existingPlaintext.port = parseInt(await decryptText(existingData.port, aesKey)) || 22;
              existingPlaintext.username = await decryptText(existingData.username, aesKey);
              existingPlaintext.password = await decryptText(existingData.password, aesKey);
              existingPlaintext.privateKey = await decryptText(existingData.privateKey, aesKey);
            } else {
              existingPlaintext = existingData;
            }
          } catch (_) {}
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

        await env.WEBSSH_KV.put(`connection:${id}`, JSON.stringify({
          id,
          name: storedName,
          host: storedHost,
          port: storedPort,
          username: storedUsername,
          password: storedPassword,
          privateKey: storedPrivateKey,
        }));

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

    // 3.5 API: 排序
    if (url.pathname === '/api/connections/order' && request.method === 'POST') {
      try {
        const { order } = await request.json();
        if (Array.isArray(order)) {
          await env.WEBSSH_KV.put('connections_order', JSON.stringify(order));
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ error: '無效的排序格式' }), { status: 400 });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 3.6 - 3.8 API: 腳本管理
    if (url.pathname === '/api/scripts' && request.method === 'GET') {
      try {
        const list = await env.WEBSSH_KV.list({ prefix: 'script:' });
        const values = await Promise.all(list.keys.map(key => env.WEBSSH_KV.get(key.name)));
        const scripts = values.filter(Boolean).map(v => JSON.parse(v));
        return new Response(JSON.stringify(scripts), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    if (url.pathname === '/api/scripts' && request.method === 'POST') {
      try {
        const data = await request.json();
        const id = data.id || crypto.randomUUID();
        await env.WEBSSH_KV.put(`script:${id}`, JSON.stringify({ id, name: data.name, content: data.content }));
        return new Response(JSON.stringify({ success: true, id }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/scripts/') && request.method === 'DELETE') {
      try {
        const id = url.pathname.split('/').pop();
        await env.WEBSSH_KV.delete(`script:${id}`);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 4. API: 刪除連線
    if (url.pathname.startsWith('/api/connections/') && request.method === 'DELETE') {
      try {
        const id = url.pathname.split('/').pop();
        await env.WEBSSH_KV.delete(`connection:${id}`);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 🚀 5. WebSocket: SSH 終端通道（T-1: 支援 In-Band 快速連線認證 /ssh/quick）
    if (url.pathname.startsWith('/ssh/') && request.headers.get('Upgrade') === 'websocket') {
      const endpoint = url.pathname.split('/').pop();
      if (endpoint === 'quick') {
        // T-1: 第一幀 In-Band 握手，零 URL 溢位風險
        return handleSSHUpgrade(request, env, null, isAuthEnabled, adminPassword, deriveKey, decryptText, parseQuickConnectToken);
      }

      // 一般持久儲存連線
      const connectionVal = await env.WEBSSH_KV.get(`connection:${endpoint}`);
      if (!connectionVal) return new Response('連線配置不存在', { status: 404 });
      const config = JSON.parse(connectionVal);

      return handleSSHUpgrade(request, env, config, isAuthEnabled, adminPassword, deriveKey, decryptText, parseQuickConnectToken);
    }

    // 🚀 6. WebSocket: SFTP 通道（T-1: 支援 In-Band 快速連線認證 /sftp/quick）
    if (url.pathname.startsWith('/sftp/') && request.headers.get('Upgrade') === 'websocket') {
      const endpoint = url.pathname.split('/').pop();
      if (endpoint === 'quick') {
        // T-1: 第一幀 In-Band 握手
        return handleSFTPUpgrade(request, env, null, isAuthEnabled, adminPassword, deriveKey, decryptText, parseQuickConnectToken);
      }

      // 一般持久儲存連線
      const connectionVal = await env.WEBSSH_KV.get(`connection:${endpoint}`);
      if (!connectionVal) return new Response('連線配置不存在', { status: 404 });
      const config = JSON.parse(connectionVal);

      return handleSFTPUpgrade(request, env, config, isAuthEnabled, adminPassword, deriveKey, decryptText, parseQuickConnectToken);
    }

    return new Response('Not Found', { status: 404 });
  },
};
