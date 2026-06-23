import * as esbuild from 'esbuild';

// 建立一個 esbuild 插件，用來忽略二進位原生模組 (.node 檔案)
// 因為 Cloudflare Workers 環境不支援原生二進位元件，
// 而 ssh2 內部具備自動降級（try/catch 降級至純 JS）的邏輯。
// 我們需要讓 esbuild 在打包時，把所有的 .node 檔案替換為空模組，以防止建置錯誤。
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
    platform: 'node', // 保持 node 內置模組（如 net, crypto）為外部引用，交由 wrangler 解析
    external: ['cloudflare:sockets'], // 保持 Cloudflare 特有 API 外部化
    plugins: [ignoreNodeExtensionsPlugin], // 注入忽略 .node 的自訂插件
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
