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
// 包含自動補齊 ESM Namespace Object 所缺少的 hasOwnProperty 方法
const bannerJs = `import { createRequire } from 'node:module';
const _origRequire = createRequire(import.meta.url || 'file:///index.js');
const require = (name) => {
  const nodeBuiltins = ['assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'];
  
  // 1. 阻斷不支援的進程管理模組
  if (name === 'child_process' || name === 'node:child_process') {
    return { spawn: () => {}, exec: () => {}, execFile: () => {}, fork: () => {} };
  }

  let res;
  try {
    // 2. 自動為內建模組加上 node: 前綴並載入
    res = _origRequire(nodeBuiltins.includes(name) ? 'node:' + name : name);
  } catch (err) {
    console.error('=================== [WEBSSH-REQUIRE 診斷日誌] ===================');
    console.error('【加載異常】：無法在 Cloudflare Workers 環境加載模組 ->', name);
    console.error('【底層錯誤】：', err.stack || err.message || err);
    console.error('================================================================');
    
    return new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'then') return undefined;
        if (prop === 'hasOwnProperty') return () => false;
        return () => {};
      }
    });
  }

  // 3. 核心修復：Cloudflare 回傳的 ESM Namespace Object 沒有 hasOwnProperty
  // 攔截屬性讀取，將缺失的原型方法補齊，防止 safer-buffer 等老舊庫報錯
  if (res && typeof res === 'object' && typeof res.hasOwnProperty !== 'function') {
    return new Proxy(res, {
      get(target, prop) {
        if (prop === 'hasOwnProperty') {
          return Object.prototype.hasOwnProperty.bind(target);
        }
        if (prop === 'toString') {
          return Object.prototype.toString.bind(target);
        }
        return target[prop];
      }
    });
  }

  return res;
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
