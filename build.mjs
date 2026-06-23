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
// 因為 Cloudflare Workers 環境不支援原生二進位元件，
// 而 ssh2 內部具備自動降級（try/catch 降級至純 JS）的邏輯。
const ignoreNodeExtensionsPlugin = {
  name: 'ignore-node-extensions',
  setup(build) {
    // 攔截所有以 .node 結尾的引用
    build.onResolve({ filter: /\.node$/ }, args => ({
      path: args.path,
      namespace: 'ignore-node-extensions-namespace',
    }));

    // 將該引用載入為空的 CommonJS 模組
    build.onLoad({ filter: /.*/, namespace: 'ignore-node-extensions-namespace' }, () => ({
      contents: 'module.exports = {};',
      loader: 'js',
    }));
  },
};

try {
  await esbuild.build({
    entryPoints: ['src/index.js'],
    bundle: true,
    outfile: 'dist/index.js',
    format: 'esm',
    target: 'es2022',
    platform: 'browser', // 改為 browser，讓 esbuild 將 CommonJS 的 require 轉換為 ESM 的 static import
    external: [
      'cloudflare:sockets',
      ...nodeBuiltins,
      ...nodeBuiltins.map(name => `node:${name}`) // 同時支援帶 node: 與不帶前綴的導入方式
    ],
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
