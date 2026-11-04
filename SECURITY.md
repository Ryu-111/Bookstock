# セキュリティ

## 脆弱性の報告

公開のIssueには書かず、GitHubの「Security」タブ → 「Report a vulnerability」から非公開で報告してください。

## 方針

- 読書記録は端末のIndexedDBにだけ置き、外部へ送らない（ADR-0001）。
- APIキーを埋め込まない（ADR-0003）。書誌API・JSONインポート・IndexedDBの値は境界で検証する。
- 依存は `npm audit`（CI）、Dependabot（公開後7日待つ）、CodeQL、dependency-reviewで監視する。
