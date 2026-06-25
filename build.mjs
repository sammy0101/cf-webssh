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

// 🆕 新增：建立一個自訂的 esbuild 插件，專用來將 public/app.js 讀取為靜態字串 (修改處)
const clientJsLoaderPlugin = {
  name: 'client-js-loader',
  setup(build) {
    build.onResolve({ filter: /^client-js:/ }, args => ({
      path: args.path.replace(/^client-js:/, ''),
      namespace: 'client-js-namespace',
    }));
    build.onLoad({ filter: /.*/, namespace: 'client-js-namespace' }, async args => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(args.path, 'utf8');
      return {
        // 將前端 js 文字內容編譯為 esm 預設導出，以便後端可以直接 import 
        contents: `export default ${JSON.stringify(content)};`,
        loader: 'js',
      };
    });
  },
};

// 撰寫具備高度診斷與防禦機制的 Banner 代碼
const bannerJs = `// @ts-nocheck
import { createRequire } from 'node:module';
const __filename = 'index.js';
const __dirname = '/';
const _origRequire = createRequire(import.meta.url || 'file:///index.js');
const require = (name) => {
  const nodeBuiltins = ['assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'];
  
  if (name === 'child_process' || name === 'node:child_process') {
    return { spawn: () => {}, exec: () => {}, execFile: () => {}, fork: () => {} };
  }

  let res;
  try {
    res = _origRequire(name);
  } catch (err) {
    try {
      res = _origRequire('node:' + name);
    } catch (err2) {
      return new Proxy({}, {
        get: (t, p) => {
          if (p === 'then') return undefined;
          if (p === 'hasOwnProperty') return () => false;
          return () => {};
        }
      });
    }
  }

  if (typeof res === 'function') {
    return res;
  }

  if (res && typeof res === 'object') {
    const hasProto = (Object.getPrototypeOf(res) !== null);

    if (hasProto) {
      return res;
    }

    const ns = res;
    const baseName = name.replace(/^node:/, '');
    let ctor = null;

    if (typeof ns.default === 'function') {
      ctor = ns.default;
    } else if (typeof ns[baseName] === 'function') {
      ctor = ns[baseName];
    } else {
      const pascal = baseName.charAt(0).toUpperCase() + baseName.slice(1);
      if (typeof ns[pascal] === 'function') ctor = ns[pascal];
    }

    if (ctor) {
      for (const key of Object.getOwnPropertyNames(ns)) {
        if (key !== 'default' && key !== '__esModule' && !(key in ctor)) {
          try { ctor[key] = ns[key]; } catch(e) {}
        }
      }
      if (typeof ctor.hasOwnProperty !== 'function') {
        ctor.hasOwnProperty = Object.prototype.hasOwnProperty.bind(ctor);
      }
      return ctor;
    }

    const wrapper = function() {};
    for (const key of Object.getOwnPropertyNames(ns)) {
      if (key !== '__esModule' && key !== 'constructor') {
        try { wrapper[key] = ns[key]; } catch(e) {}
      }
    }
    if (typeof wrapper.hasOwnProperty !== 'function') {
      wrapper.hasOwnProperty = Object.prototype.hasOwnProperty.bind(wrapper);
    }
    return wrapper;
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
    // 加載我們自訂的 clientJsLoaderPlugin
    plugins: [ignoreNodeExtensionsPlugin, clientJsLoaderPlugin], 
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
