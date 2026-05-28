import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスでビルド → サイト直下でも /dropping/ 配下でも動く
  base: './',
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['.trycloudflare.com', 'localhost'],
  },
  build: {
    target: 'es2020',
  },
});
