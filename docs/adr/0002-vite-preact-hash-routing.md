# ADR-0002: Vite + TypeScript + Preact、ハッシュルーティング、PWA

- ステータス: 承認済み
- 日付: 2026-10-31
- 決定者: ryu

## コンテキスト

開発ハーネスはjev-routerと同じ（TypeScript strict / ESM、ESLint、Prettier、Node標準テスト＋tsx）。スマホでの利用が中心で、バンドルを小さく保ちたい。Pagesは `/Bookstock/` のサブパスで配信され、存在しないパスは404になる。

## 決定

- ビルドはVite、UIはPreact（約4KB）を使う。`base: '/Bookstock/'`。
- ルーティングは `#/...` のハッシュ方式にする。404.htmlを使う転送はしない。
- グラフは依存を足さず、SVGで自作する。
- M6でmanifestとService WorkerによるPWAにする。

## 検討した選択肢

- React: 機能は同じだがバンドルが大きい。
- 素のDOM: 依存はゼロだが、フォームと一覧の状態管理が煩雑になる。
- Chart.jsなどのグラフライブラリ: 描画は楽だが、必要なのは数種類の棒グラフとヒートマップなので、まずは自作する。必要になったら再検討する。
