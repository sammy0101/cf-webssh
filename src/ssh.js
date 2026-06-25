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
