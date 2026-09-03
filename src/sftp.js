import { Client } from 'ssh2';

export async function handleSFTPUpgrade(request, env, config, isAuthEnabled, adminPassword, deriveKey, decryptText, parseQuickConnectToken) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  const isQuick = !config;
  let finalConfig = config;
  let authTimeout = null;

  const startSFTP = async (cfg) => {
    let finalHost = cfg.host || '';
    let finalPort = cfg.port || 22;
    let finalUsername = cfg.username || '';
    let finalPassword = cfg.password || '';
    let finalPrivateKey = cfg.privateKey || '';

    if (isAuthEnabled && !cfg.isPlaintext) {
      try {
        const aesKey = await deriveKey(adminPassword);
        finalHost = await decryptText(cfg.host, aesKey);
        finalPort = parseInt(await decryptText(cfg.port, aesKey)) || 22;
        finalUsername = await decryptText(cfg.username, aesKey);
        finalPassword = await decryptText(cfg.password, aesKey);
        finalPrivateKey = await decryptText(cfg.privateKey, aesKey);
      } catch (err) {
        server.send(JSON.stringify({ status: 'error', message: `憑據解密失敗: ${err.message}` }));
        server.close(1011);
        return;
      }
    }

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
          server.send(JSON.stringify({ status: 'error', message: '遠端 SFTP 仍在建立中，請稍候。' }));
          return;
        }

        // 讀取檔案清單（含八進位權限）
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
                modifyTime: item.attrs.mtime,
                permissions: (item.attrs.mode & 0o777).toString(8).padStart(3, '0') // 🚀 八進位權限 (如 755)
              })).sort((a, b) => {
                if (a.isDir && !b.isDir) return -1;
                if (!a.isDir && b.isDir) return 1;
                return a.name.localeCompare(b.name);
              });
              server.send(JSON.stringify({ status: 'list', path: targetPath, files }));
            });
          });
        }

        // 🚀 T-3: 新建資料夾 (mkdir)
        else if (msg.action === 'mkdir') {
          sftpClient.mkdir(msg.path, (err) => {
            if (err) server.send(JSON.stringify({ status: 'error', message: `建立資料夾失敗: ${err.message}` }));
            else server.send(JSON.stringify({ status: 'mkdir_ok', path: msg.path }));
          });
        }

        // 🚀 T-3: 新建空檔案 (touch)
        else if (msg.action === 'touch') {
          sftpClient.writeFile(msg.path, '', 'utf8', (err) => {
            if (err) server.send(JSON.stringify({ status: 'error', message: `建立檔案失敗: ${err.message}` }));
            else server.send(JSON.stringify({ status: 'touch_ok', path: msg.path }));
          });
        }

        // 🚀 T-3: 重新命名 / 移動 (rename)
        else if (msg.action === 'rename') {
          sftpClient.rename(msg.oldPath, msg.newPath, (err) => {
            if (err) server.send(JSON.stringify({ status: 'error', message: `重新命名失敗: ${err.message}` }));
            else server.send(JSON.stringify({ status: 'rename_ok' }));
          });
        }

        // 🚀 T-3: 修改 Linux 權限 (chmod)
        else if (msg.action === 'chmod') {
          const mode = typeof msg.mode === 'string' ? parseInt(msg.mode, 8) : Number(msg.mode);
          sftpClient.chmod(msg.path, mode, (err) => {
            if (err) server.send(JSON.stringify({ status: 'error', message: `修改權限失敗: ${err.message}` }));
            else server.send(JSON.stringify({ status: 'chmod_ok' }));
          });
        }

        else if (msg.action === 'delete') {
          const callback = (err) => {
            if (err) server.send(JSON.stringify({ status: 'error', message: `刪除失敗: ${err.message}` }));
            else server.send(JSON.stringify({ status: 'delete_ok' }));
          };
          if (msg.isDir) sftpClient.rmdir(msg.path, callback);
          else sftpClient.unlink(msg.path, callback);
        }

        else if (msg.action === 'upload_start') {
          uploadStream = sftpClient.createWriteStream(msg.path, { flags: 'w', mode: 0o644 });
          uploadStream.on('error', (err) => {
            server.send(JSON.stringify({ status: 'error', message: `開啟遠端寫入出錯: ${err.message}` }));
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
            uploadStream.end(() => { uploadStream = null; });
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
          if (downloadStream) downloadStream.resume();
        }

        else if (msg.action === 'file_read') {
          sftpClient.readFile(msg.path, 'utf8', (err, data) => {
            if (err) server.send(JSON.stringify({ status: 'error', message: `讀取失敗: ${err.message}` }));
            else server.send(JSON.stringify({ status: 'file_read_ok', path: msg.path, content: data }));
          });
        }

        else if (msg.action === 'file_write') {
          sftpClient.writeFile(msg.path, msg.content, 'utf8', (err) => {
            if (err) server.send(JSON.stringify({ status: 'error', message: `寫入失敗: ${err.message}` }));
            else server.send(JSON.stringify({ status: 'file_write_ok', path: msg.path }));
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

      if (finalPrivateKey) connectOptions.privateKey = finalPrivateKey;
      else connectOptions.password = finalPassword;

      sshClient.connect(connectOptions);
    } catch (err) {
      server.send(JSON.stringify({ error: `SFTP 握手失敗: ${err.message}` }));
      server.close(1011);
    }
  };

  // 🚀 T-1: 若為快速連線，等待客戶端第一幀 In-Band 發送認證 Token
  if (isQuick) {
    authTimeout = setTimeout(() => {
      try {
        server.send(JSON.stringify({ status: 'error', message: 'SFTP 認證超時' }));
        server.close(4001);
      } catch (_) {}
    }, 8000);

    const initAuthHandler = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === 'init' && msg.token) {
          clearTimeout(authTimeout);
          server.removeEventListener('message', initAuthHandler);
          finalConfig = await parseQuickConnectToken(msg.token, adminPassword, isAuthEnabled);
          startSFTP(finalConfig);
        }
      } catch (err) {
        clearTimeout(authTimeout);
        server.send(JSON.stringify({ status: 'error', message: `認證失敗: ${err.message}` }));
        server.close(4002);
      }
    };
    server.addEventListener('message', initAuthHandler);
  } else {
    startSFTP(finalConfig);
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
