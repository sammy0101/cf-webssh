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
    res = _origRequire(nodeBuiltins.includes(name) ? 'node:' + name : name);
  } catch (err) {
    console.error('=================== [WEBSSH-REQUIRE] ===================');
    console.error('Cannot load module:', name, err.message);
    console.error('=========================================================');
    return new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'then') return undefined;
        if (prop === 'hasOwnProperty') return () => false;
        return () => {};
      }
    });
  }

  if (res && typeof res === 'object' && typeof res !== 'function') {
    const baseName = name.replace(/^node:/, '');

    if (res.default && typeof res.default === 'function') {
      const main = res.default;
      for (const key of Object.keys(res)) {
        if (key !== 'default' && !(key in main)) {
          try { main[key] = res[key]; } catch(e) {}
        }
      }
      if (typeof main.hasOwnProperty !== 'function') {
        main.hasOwnProperty = Object.prototype.hasOwnProperty.bind(main);
      }
      return main;
    }

    if (res[baseName] && typeof res[baseName] === 'function') {
      const main = res[baseName];
      for (const key of Object.keys(res)) {
        if (key !== baseName && !(key in main)) {
          try { main[key] = res[key]; } catch(e) {}
        }
      }
      if (typeof main.hasOwnProperty !== 'function') {
        main.hasOwnProperty = Object.prototype.hasOwnProperty.bind(main);
      }
      return main;
    }

    const dummy = function() {};
    for (const key of Object.keys(res)) {
      try { dummy[key] = res[key]; } catch(e) {}
    }
    if (typeof dummy.hasOwnProperty !== 'function') {
      dummy.hasOwnProperty = Object.prototype.hasOwnProperty.bind(dummy);
    }
    return dummy;
  }

  if (res && typeof res === 'object' && typeof res.hasOwnProperty !== 'function') {
    return new Proxy(res, {
      get(target, prop) {
        if (prop === 'hasOwnProperty') return Object.prototype.hasOwnProperty.bind(target);
        if (prop === 'toString') return Object.prototype.toString.bind(target);
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
