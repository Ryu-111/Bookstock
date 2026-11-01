# Bookstock — 読書記録アプリ

最終更新: 2026-11-01（楽天ブックスAPIを任意で追加）

## 目的

紙の本・電子書籍・オーディオブックの読書を、バーコードまたはタイトル検索で手早く記録し、読書量を見える化する。GitHub Pagesに置く静的なWebアプリで、サーバーとアカウントを持たない。

## 成功の基準

- 紙の本はバーコードを読み取ってから、2タップ以内で登録できる。
- ISBNのない電子書籍・オーディオブックも、タイトル検索または手入力で登録できる。
- 形式（紙 / 電子 / オーディオ）ごとに、冊数・ページ数・再生時間を月別・年別に見られる。
- 書誌APIが落ちていても、手入力で登録できる。オフラインでも記録と閲覧ができる。
- JSONにエクスポートして別の端末へインポートすると、記録が欠けずに戻る。
- APIキー・ログイン・サーバー費用がいらない。

## スコープ

- 対象: 本の検索・登録（バーコード、ISBN入力、タイトル検索、手入力）、読書記録（状態・期間・評価・メモ・進捗）、本棚、統計、JSONのエクスポート・インポート、PWA。
- 対象外:
  - 端末間の自動同期・アカウント（将来、Gistなどで検討）。
  - SNS機能・ほかのユーザーとの共有。
  - APIキーを要する検索サービス（楽天ブックスAPIなど）。
  - 電子書籍ストア・Audibleからの購入履歴の自動取り込み。

## 用語

| 用語                   | 意味                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| 本（Book）             | 書誌情報。ISBN・タイトル・著者・書影など。形式を持たない                                          |
| 読書記録（Record）     | ある本をある形式で読んだ1回分の記録。状態・期間・評価・メモを持つ                                 |
| 形式（format）         | `paper`（紙）/ `ebook`（電子書籍）/ `audiobook`（オーディオブック）                               |
| 状態（status）         | `want`（読みたい）/ `stacked`（積読）/ `reading`（読書中）/ `finished`（読了）/ `dropped`（中断） |
| 進捗ログ（ReadingLog） | 日付ごとに読んだページ数、または聴いた分数                                                        |
| 書籍JAN                | 書籍の2段バーコード。1段目がISBN（978/979）、2段目が分類・価格（192始まり）                       |

## 前提・制約

- GitHub Pagesは静的ホスティングのみ。プロジェクトサイトは `/Bookstock/` のサブパスで配信され、SPAのパスは404になる。
- リポジトリはpublicにする（無料プランでPagesを使うため）。コードは公開されるが、読書記録は各端末のブラウザにだけ残る。
- IndexedDBのデータは、ブラウザのデータ消去・ストレージ逼迫で消えうる。`navigator.storage.persist()` を要求し、定期的なエクスポートを促す。
- 書誌API（どれもキー不要）:
  - openBD `https://api.openbd.jp/v1/get?isbn=`: 国内の書籍に強い。CORS可。
  - 国立国会図書館サーチ OpenSearch: ISBN・タイトルで検索できる。XMLで返る。ブラウザから直接呼べるか（CORS）は未確認。
  - Google Books `https://www.googleapis.com/books/v1/volumes`: キーなしでも呼べるが、日次の上限がある。洋書・電子書籍に強い。
  - 楽天ブックス書籍検索API: 利用者が自分のアプリIDを設定画面に入れた場合だけ使う。書影・読み仮名に強い（ADR-0003の追記）。
- `BarcodeDetector` はChrome（Android/デスクトップ）にあり、iOS Safariにはない（2026-10時点の認識。実装時に再確認する）。
- カメラにはHTTPSが必要。GitHub PagesはHTTPSなので満たす。
- 開発はjev-router（`jh`）経由で行う。jhの製品Hookは `.jh.json` を読み、Claude Codeで編集ごとのPrettierとStopの1次チェック（`npm run check`）を行う。CodexのHookは対象外なので、pre-commitとCIで担保する。

## 決定

- [ADR-0001](docs/adr/0001-static-spa-local-storage.md) 静的SPAをGitHub Pagesに置き、データは端末のIndexedDBに保存する。JSONで入出力する
- [ADR-0002](docs/adr/0002-vite-preact-hash-routing.md) Vite + TypeScript + Preact、ハッシュルーティング、PWA
- [ADR-0003](docs/adr/0003-keyless-bibliographic-apis.md) 書誌はキー不要のAPIを openBD → NDLサーチ → Google Books の順に引き、なければ手入力
- [ADR-0004](docs/adr/0004-barcode-detector-with-zxing-fallback.md) バーコードは `BarcodeDetector`、非対応ブラウザは `@zxing/browser`。978/979のEAN-13だけ受け付ける
- [ADR-0005](docs/adr/0005-format-on-record.md) 形式（紙 / 電子 / オーディオ）は本ではなく読書記録に持たせる
- 実装の順序は [docs/plan.md](docs/plan.md)
