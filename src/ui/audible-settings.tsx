import { useState } from 'preact/hooks';
import { audibleBookmarklet } from '../lookup/audible.js';
import { Group } from './ios.js';

/** Audibleから取り込むブックマークレットの案内。 */
export function AudibleSettings() {
  const code = audibleBookmarklet(
    `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`,
  );
  const [message, setMessage] = useState<{ text: string; error: boolean }>();

  return (
    <section aria-label="Audibleから取り込む">
      <Group
        header="Audibleから取り込む"
        footer={
          <>
            Audibleの作品ページ（www.audible.co.jp/pd/…）で開くと、題名・著者・長さ・書影を登録画面に入れます。Androidは、コードをコピーし、Chromeで適当なページをブックマークして、名前を「bookstock」、URLをコピーしたコードに書き換えます。Audibleの作品ページをChromeで開き、アドレスバーに「bookstock」と入力して、候補のブックマークを選ぶと動きます（ブックマーク一覧から開いても動きません）。PCは下のリンクをブックマークバーへドラッグします。うまく開かないときは、開いたページのURLをコピーし、登録画面の検索欄に貼り付けてください。AudibleのAPIは非公式なので、仕様が変わると使えなくなることがあります。
          </>
        }
      >
        <a class="cell cell-button" href={code}>
          Bookstockに追加（ブックマークレット）
        </a>
        <button
          type="button"
          class="cell cell-button"
          onClick={() => {
            navigator.clipboard.writeText(code).then(
              () => setMessage({ text: 'コピーしました', error: false }),
              () =>
                setMessage({
                  text: 'コピーできませんでした',
                  error: true,
                }),
            );
          }}
        >
          コードをコピー
        </button>
      </Group>
      {message && (
        <p role={message.error ? 'alert' : 'status'} class="footnote">
          {message.text}
        </p>
      )}
    </section>
  );
}
