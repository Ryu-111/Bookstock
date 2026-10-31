# Bookstock

紙の本・電子書籍・オーディオブックの読書記録をつけて、見える化するWebアプリです。GitHub Pagesで公開し、データはブラウザ（IndexedDB）にだけ保存します。現在は設計と開発ハーネスの段階で、アプリは雛形です。

設計は [CONTEXT.md](CONTEXT.md)、[アーキテクチャ](docs/architecture.md)、[ADR](docs/adr/)、[実装計画](docs/plan.md) を参照してください。エージェント向けのルールは [AGENTS.md](AGENTS.md) にあります。

## 開発の準備

- Node 22.22.3（`.nvmrc`）、npm、Git、rtk、[jev-router](https://github.com/Ryu-111/jev-router)（`jh`）を使います。
- TypeScript strict / ESM、Preact、Vite、ESLint、Prettier、Node標準テスト＋tsxで統一します（jev-routerと同じ構成）。

```sh
rtk proxy npm ci
rtk proxy npm run check
npm run dev   # http://localhost:5173/Bookstock/
```

`npm ci` のprepareで、Huskyがpre-commitを有効にします。pre-commitはindexを一時ディレクトリに展開し、ステージ済みファイルの書式・lintと、全体の型検査・テストを実行します。

| コマンド               | 用途                       |
| ---------------------- | -------------------------- |
| `npm run dev`          | 開発サーバー               |
| `npm run format`       | Prettierで修正             |
| `npm run format:check` | 書式確認、書き込みなし     |
| `npm run lint`         | ESLint、warningも失敗      |
| `npm run typecheck`    | strict型検査               |
| `npm test`             | 合成fixtureでテスト        |
| `npm run build`        | `dist/` へビルド           |
| `npm run check`        | 上記の検証＋テスト＋ビルド |

## jev-router（jh）で開発する

1. jev-routerで `jh install` を済ませておきます（Hook・Delegate MCP・`jev-workflow` Skillがグローバルに入ります）。
2. このリポジトリで `jh claude` または `jh codex` を起動します。モデルとeffortはターンごとにJevが選びます。
3. Claude Codeでは、jhの製品Hookが `.jh.json` を読み、編集のたびにPrettierをかけます。Stopでは1次チェックとして `npm run check` と `tsc --noEmit` を実行し、そのあとJevが完了を判定します。
4. CodexはjhのHookの対象外です。pre-commitとCIで検証します。
5. もう一方のベンダーにレビューを頼むときは、Delegate MCPの `mode=read` を使います。

このリポジトリには独自の開発Hookを置きません（jhのHookと二重に動かさないため）。

## GitHub Pagesへの公開

1. リポジトリをpublicにします（無料プランでPagesを使うため）。
2. Settings → Pages → Build and deployment の Source を「GitHub Actions」にします。
3. mainへpushすると `.github/workflows/pages.yml` が `npm run check` → ビルド → デプロイを行います。公開URLは `https://<user>.github.io/Bookstock/` です。

## ドキュメントMCP

`.mcp.json`（Claude Code）と `.codex/config.toml`（Codex）に、context7とopenaiDeveloperDocsを設定しています。context7は環境変数 `CONTEXT7_API_KEY` を使います。キーの値はリポジトリに書きません。

## ライセンス

MIT。`scripts/pre-commit.ts` と `scripts/process.ts` は、jev-router（MIT、同じ作者）から流用しました。
