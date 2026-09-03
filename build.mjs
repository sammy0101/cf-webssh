import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const version = pkg.version || '1.0.0';

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 
  'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 
  'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'
];

// 忽略原生二進位模組
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

// 讀取前端 app.js 為靜態字串
const clientJsLoaderPlugin = {
  name: 'client-js-loader',
  setup(build) {
    build.onResolve({ filter: /^client-js:/ }, async args => {
      const path = await import('node:path');
      const cleanPath = args.path.replace(/^client-js:/, '');
      const absPath = path.resolve(args.resolveDir, cleanPath);
      return { path: absPath, namespace: 'client-js-namespace' };
    });
    build.onLoad({ filter: /.*/, namespace: 'client-js-namespace' }, async args => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(args.path, 'utf8');
      return {
        contents: `export default ${JSON.stringify(content)};`,
        loader: 'js',
      };
    });
  },
};

// 🚀 Zero-CDN: 自動打包 xterm 與其擴展插件成 vendor 靜態資源
const vendorBundlePlugin = {
  name: 'vendor-bundle-loader',
  setup(build) {
    let cachedVendorJs = null;
    let cachedVendorCss = null;

    build.onResolve({ filter: /^vendor-(js|css):client$/ }, args => ({
      path: args.path,
      namespace: 'vendor-bundle-namespace'
    }));

    build.onLoad({ filter: /.*/, namespace: 'vendor-bundle-namespace' }, async args => {
      if (!cachedVendorJs) {
        const bundle = await esbuild.build({
          stdin: {
            contents: `
              import { Terminal } from 'xterm';
              import { FitAddon } from '@xterm/addon-fit';
              import { SearchAddon } from '@xterm/addon-search';
              import { WebLinksAddon } from '@xterm/addon-web-links';
              import 'xterm/css/xterm.css';

              window.Terminal = Terminal;
              window.FitAddon = { FitAddon };
              window.SearchAddon = { SearchAddon };
              window.WebLinksAddon = { WebLinksAddon };
            `,
            resolveDir: '.',
            loader: 'js'
          },
          bundle: true,
          format: 'iife',
          minify: true,
          write: false,
          outdir: 'out'
        });

        for (const file of bundle.outputFiles) {
          if (file.path.endsWith('.js')) {
            cachedVendorJs = file.text;
          } else if (file.path.endsWith('.css')) {
            cachedVendorCss = file.text;
          }
        }
      }

      const isJs = args.path.startsWith('vendor-js:');
      const content = isJs ? (cachedVendorJs || '') : (cachedVendorCss || '');
      return {
        contents: `export default ${JSON.stringify(content)};`,
        loader: 'js'
      };
    });
  }
};

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

  if (typeof res === 'function') return res;

  if (res && typeof res === 'object') {
    if (Object.getPrototypeOf(res) !== null) return res;
    const ns = res;
    const baseName = name.replace(/^node:/, '');
    let ctor = null;

    if (typeof ns.default === 'function') ctor = ns.default;
    else if (typeof ns[baseName] === 'function') ctor = ns[baseName];
    else {
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
    banner: { js: bannerJs },
    define: { '__APP_VERSION__': JSON.stringify(version) },
    plugins: [ignoreNodeExtensionsPlugin, clientJsLoaderPlugin, vendorBundlePlugin], 
    loader: { '.html': 'text' },
    alias: { 'cpu-features': './mocks/cpu-features.js' }
  });
  console.log('Build completed successfully.');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
