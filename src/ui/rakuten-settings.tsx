import { useState } from 'preact/hooks';
import { testRakuten } from '../lookup/index.js';
import { browserXmlParser } from '../lookup/ndl.js';
import {
  DEFAULT_RAKUTEN_ENDPOINT,
  parseRakutenConfig,
} from '../lookup/rakuten.js';
import type { RakutenConfig } from '../lookup/rakuten.js';
import { Cell, Group } from './ios.js';
import { outcomeLabel } from './labels.js';

export function RakutenSettings({
  config,
  onChange,
}: {
  config: RakutenConfig | null;
  /** 保存できたらtrue */
  onChange: (config: RakutenConfig | null) => boolean;
}) {
  const [fields, setFields] = useState({
    applicationId: config?.applicationId ?? '',
    accessKey: config?.accessKey ?? '',
    endpoint: config?.endpoint ?? DEFAULT_RAKUTEN_ENDPOINT,
  });
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [testing, setTesting] = useState(false);
  const set = (key: keyof typeof fields) => (e: Event) => {
    if (e.currentTarget instanceof HTMLInputElement)
      setFields({ ...fields, [key]: e.currentTarget.value });
  };

  const parsed = () => parseRakutenConfig(fields);

  return (
    <form
      aria-label="楽天ブックスAPI"
      onSubmit={(e) => {
        e.preventDefault();
        if (!fields.applicationId.trim()) {
          const ok = onChange(null);
          setMessage({
            text: ok ? '設定を消しました' : '保存できませんでした',
            error: !ok,
          });
          return;
        }
        const next = parsed();
        if (!next) {
          setMessage({
            text: 'アプリID・アクセスキーは英数字と「-」「_」、URLは https://〜.rakuten.co.jp/ で入力してください',
            error: true,
          });
          return;
        }
        const ok = onChange(next);
        setMessage({
          text: ok ? '保存しました' : 'このブラウザでは保存できません',
          error: !ok,
        });
      }}
    >
      <Group
        header="楽天ブックスAPI"
        footer={
          <>
            設定すると、ISBN・タイトル検索で楽天ブックスを最初に使い、書影・出版日・読み仮名を取得します。値はこのブラウザにだけ保存され、JSONの書き出しには含まれません。IDは
            <a
              href="https://webservice.rakuten.co.jp/"
              target="_blank"
              rel="noreferrer"
            >
              楽天ウェブサービス
            </a>
            で無料で発行できます。
          </>
        }
      >
        <Cell label="アプリID">
          <input
            value={fields.applicationId}
            onInput={set('applicationId')}
            placeholder="未設定"
            autoComplete="off"
            spellcheck={false}
          />
        </Cell>
        <Cell label="アクセスキー">
          <input
            type="password"
            value={fields.accessKey}
            onInput={set('accessKey')}
            placeholder="必須"
            autoComplete="off"
          />
        </Cell>
        <Cell label="URL" stacked>
          <input
            aria-label="エンドポイントURL"
            value={fields.endpoint}
            onInput={set('endpoint')}
            inputMode="url"
            spellcheck={false}
          />
        </Cell>
        <button type="submit" class="cell cell-button">
          保存
        </button>
        <button
          type="button"
          class="cell cell-button"
          disabled={testing}
          onClick={() => {
            const next = parsed();
            if (!next) {
              setMessage({
                text: 'アプリIDとURLを確認してください',
                error: true,
              });
              return;
            }
            setTesting(true);
            void testRakuten(next, {
              fetch: (url, init) => window.fetch(url, init),
              parseXml: browserXmlParser,
            })
              .then((a) =>
                setMessage({
                  text:
                    a.outcome === 'found'
                      ? '接続できました'
                      : `${outcomeLabel[a.outcome]}${a.detail ? `（${a.detail}）` : ''}`,
                  error: a.outcome !== 'found',
                }),
              )
              .finally(() => setTesting(false));
          }}
        >
          {testing ? 'テスト中…' : '接続テスト'}
        </button>
      </Group>
      {message && (
        <p role={message.error ? 'alert' : 'status'} class="footnote">
          {message.text}
        </p>
      )}
    </form>
  );
}
