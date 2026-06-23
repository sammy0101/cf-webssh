import * as esbuild from 'esbuild';

try {
  await esbuild.build({
    entryPoints: ['src/index.js'],
    bundle: true,
    outfile: 'dist/index.js',
    format: 'esm',
    target: 'es2022',
    platform: 'node', // 保持 node 內置模組（如 net, crypto）為外部引用，交由 wrangler 解析
    external: ['cloudflare:sockets'], // 保持 Cloudflare 特有 API 外部化
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
