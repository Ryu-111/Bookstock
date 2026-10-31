import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// GitHub Pagesのプロジェクトサイトは /<リポジトリ名>/ で配信される。
export default defineConfig({
  base: '/Bookstock/',
  plugins: [preact()],
});
