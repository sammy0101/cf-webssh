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
const _origRequire = createRequire(import.meta.url || 'file:///index.js');
const require = (name) => {
  const nodeBuiltins = ['assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'];
  
  // 1. 進程控制相關模組在邊緣計算不支援，直接預先阻斷並提供基本 Mock，防止觸發底層崩潰
  if (name === 'child_process' || name === 'node:child_process') {
    console.warn('[WebSSH-Mock]: 攔截並阻斷 child_process 加載，已提供 Dummy 對象。');
    return { spawn: () => {}, exec: () => {}, execFile: () => {}, fork: () => {} };
  }

  // 2. 對其餘模組載入套用 try-catch，以便詳細輸出錯誤並提供 Proxy 安全降級
  try {
    if (nodeBuiltins.includes(name)) {
      return _origRequire('node:' + name);
    }
    return _origRequire(name);
  } catch (err) {
    // 仔細輸出錯誤，包括模組名稱與底層回報的錯誤訊息
    console.error('=================== [WEBSSH-REQUIRE 診斷日誌] ===================');
    console.error('【加載異常】：無法在 Cloudflare Workers 環境加載 Node.js 核心模組 ->', name);
    console.error('【底層錯誤】：', err.stack || err.message || err);
    console.error('【降級處理】：已對此模組套用 Proxy 防護，避免阻止 Worker 初始化部署。');
    console.error('================================================================');

    // 回傳 Proxy 安全對象，防止靜態分析及初始化期因存取未實現的屬性而崩潰
    return new Proxy({}, {
      get: (target, prop) => {
        // 防止 thenable 偵測（如 Promise.resolve 判斷）導致的無窮迴圈
        if (typeof prop === 'string' && prop === 'then') {
          return undefined;
        }
        return () => {};
      }
    });
  }
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
