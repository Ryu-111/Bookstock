# ADR-0004: バーコードは BarcodeDetector、非対応ブラウザは @zxing/browser

- ステータス: 承認済み
- 日付: 2026-10-31
- 決定者: ryu

## コンテキスト

書籍には2段のバーコードがある。1段目がISBN（978/979で始まるEAN-13）、2段目が分類・価格コード（192で始まる）。ネイティブの `BarcodeDetector` は軽くて速いが、iOS Safariでは使えない。

## 決定

- `BarcodeDetector` があり、`ean_13` に対応していれば使う。なければ `@zxing/browser` を動的importで読み込む（対応ブラウザではダウンロードしない）。
- 978/979で始まり、チェックディジットが正しいEAN-13だけを受け付ける（`src/domain/isbn.ts`）。192始まりは無視する。
- カメラが使えない場合、またはユーザーが拒否した場合は、ISBNの手入力に切り替える。

## 結果

- iOSでの読み取り速度と精度は、M3で実機確認する。

## 追記（2026-10-31、M3）

決定は変えない。実装で分かったことを残す。

- zxingは `BrowserMultiFormatOneDReader` をEAN-13だけに絞って使う。`@zxing/browser` と `@zxing/library` は動的importで別のchunkになる（約120KB gzip）。BarcodeDetectorがEAN-13に対応するブラウザでは読み込まない。
- カメラのストリームはアプリで `getUserMedia({ video: { facingMode: { ideal: 'environment' } } })` から取り、どちらの方式でも同じ手順で止める。ISBNを1つ読んだら止める。
- 開発環境のChromium（Linux、BarcodeDetectorなし）では、合成の2段バーコードを偽カメラで流し、zxingが1段目のISBNだけを返すことを確認した。BarcodeDetectorの経路と実機（iOS Safari、Android Chrome）での読み取りは未確認。
