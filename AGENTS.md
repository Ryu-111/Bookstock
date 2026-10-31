# Bookstock 開発ルール

## 作業の入口

- 回答・ドキュメントは日本語を基本とする。
- 最初に `CONTEXT.md`、`docs/architecture.md`、`docs/plan.md` と、作業に関係する `docs/adr/` を読む。承認済みADRと異なる実装は、変更理由を先にユーザーと合意する。
- 開発はjev-router（`jh`）経由で行う。ターミナルでは `jh claude` / `jh codex` で起動し、モデルとeffortの選択をJevに任せる。作業手順は `$jev-workflow` Skillに従う。
- 編集ごとのformatとStopの完了判定は、jhの製品Hook（`jh install` でグローバルに組み込む）が `.jh.json` を読んで行う。このリポジトリに独自の開発Hookは置かない。Hookがskipしたことを合格扱いにしない。
- 未コミット変更を保持する。対象外のファイル、ユーザーの変更、stage状態を勝手に変更しない。commit・pushは依頼がある場合だけ行う。
- シェルコマンドは `rtk` 経由。正確な出力・JSON・終了状態が必要なら `rtk proxy <command>` を使う。検索範囲を絞り、`rg` / `rg --files` を使う。

## 実装

- TypeScript strict、ESM、Preact。ローカルの相対importは `.js` 拡張子を付ける。
- 既存処理・ブラウザ／Node標準機能を優先する。必要のない抽象化、依存、将来用の機能は追加しない。
- 書誌API・バーコード・JSONインポート・IndexedDBから読んだ値は外部入力として境界で検証する。型assertionだけで検証済みと扱わない。
- fetchはタイムアウトと失敗経路を扱う。書誌APIが失敗しても手入力で登録を続けられるようにする。
- formatterはPrettier、lintはESLint。書式ルールを手で重複定義しない。any、lint無効化、`@ts-ignore`で問題を隠さない。
- APIキーを要するサービスを使わない（ADR-0003）。読書記録のデータは端末の外へ送らない（ADR-0001）。
- 上流のコードを流用した場合は出典とライセンスを残す。

## 検証と完了

- 変更した振る舞いと失敗経路を最小のテストで確認する。書誌APIのテストは合成fixtureを使い、実APIを通常のcheckで呼ばない。
- 編集後は対象ファイルをformatする。完了前に `rtk proxy npm run check` を実行する。
- 最終回答は変更内容・検証結果・未確認事項を簡潔に伝える。設定済み、接続済み、推測を区別する。
- ライブラリやWeb APIの仕様は使用バージョンに合わせてContext7、または公式ドキュメントで確認する。

## コマンド

`npm ci` / `npm run dev` / `npm run format` / `npm run format:check` / `npm run lint` / `npm run typecheck` / `npm test` / `npm run build` / `npm run check`
