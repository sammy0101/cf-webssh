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
