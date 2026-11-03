import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/** ビルドごとに変わる版の印。公開中の版と比べ、更新を知らせるのに使う。 */
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 公開する version.json（今の版の印）を書き出す。 */
function versionFile(): Plugin {
  return {
    name: 'bookstock-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ id: buildId }),
      });
    },
  };
}

// GitHub Pagesのプロジェクトサイトは /<リポジトリ名>/ で配信される。
export default defineConfig({
  base: '/Bookstock/',
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [preact(), versionFile()],
});
