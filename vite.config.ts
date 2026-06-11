import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスでビルド → サイト直下でも /dropping/ 配下でも動く
  base: './',
  server: {
    host: true,
    // PORT 環境変数があれば優先（プレビューツール等の自動ポート割り当て用）
    port: Number(process.env.PORT) || 5173,
    allowedHosts: ['.trycloudflare.com', 'localhost'],
  },
  build: {
    target: 'es2020',
  },
});
