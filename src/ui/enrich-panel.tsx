import { useRef, useState } from 'preact/hooks';
import type { Book, ExportFile } from '../domain/book.js';
import { enrichNdc, ndcTargets } from '../lookup/enrich.js';
import type { EnrichProgress } from '../lookup/enrich.js';
import { browserXmlParser } from '../lookup/ndl.js';
import { createThrottle } from '../lookup/recommend.js';
import { Group } from './ios.js';
import { outcomeLabel } from './labels.js';

// NDLサーチに負荷をかけないよう、1.1秒に1件ずつ問い合わせる
const throttle = createThrottle(1100);

/** 設定画面: NDLサーチでISBNから分類（NDC）を補う。 */
export function EnrichPanel({
  data,
  onUpdateBook,
  onFinish,
}: {
  data: ExportFile;
  onUpdateBook: (book: Book) => Promise<void>;
  onFinish: () => Promise<void>;
}) {
  const targets = ndcTargets(data);
  const [progress, setProgress] = useState<EnrichProgress>();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const controller = useRef<AbortController | null>(null);

  const start = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setMessage(undefined);
    setProgress({ done: 0, total: targets.length, filled: 0 });
    try {
      const result = await enrichNdc(
        targets,
        {
          fetch: (url, init) => window.fetch(url, init),
          parseXml: browserXmlParser,
          throttle,
        },
        onUpdateBook,
        setProgress,
        abort.signal,
      );
      if (result.kind === 'unreachable')
        setMessage({
          text: `NDLサーチに接続できませんでした（${outcomeLabel[result.reason]}）。時間をおいて試してください。`,
          error: true,
        });
      else if (result.kind === 'aborted')
        setMessage({
          text: `中止しました（${result.filled}冊を補完）`,
          error: false,
        });
      else
        setMessage({
          text: `${result.total}冊中${result.filled}冊の分類を補完しました`,
          error: false,
        });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : '補完に失敗しました',
        error: true,
      });
    } finally {
      setRunning(false);
      await onFinish();
    }
  };

  const minutes = Math.max(1, Math.ceil((targets.length * 1.1) / 60));
  return (
    <Group
      header="分類を補完"
      label="分類を補完"
      footer="国立国会図書館サーチにISBNだけを送り、分類（NDC）を取得します。統計の「読書マップ」とタイプ診断に使います。ページ数が空の本は、ページ数も補います。"
    >
      <div class="cell">
        <span class="cell-label">分類のない本</span>
        <span class="cell-value">
          {targets.length}冊{targets.length > 0 ? `（約${minutes}分）` : ''}
        </span>
      </div>
      {progress && (
        <div class="cell">
          <span class="cell-label">進み具合</span>
          <span class="cell-value" role="status">
            {progress.done}/{progress.total}冊・補完{progress.filled}冊
          </span>
        </div>
      )}
      {running ? (
        <button
          type="button"
          class="cell cell-button destructive"
          onClick={() => controller.current?.abort()}
        >
          中止
        </button>
      ) : (
        <button
          type="button"
          class="cell cell-button"
          disabled={targets.length === 0}
          onClick={() => void start()}
        >
          補完を開始
        </button>
      )}
      {message && (
        <div class="cell">
          <span role={message.error ? 'alert' : 'status'} class="footnote">
            {message.text}
          </span>
        </div>
      )}
    </Group>
  );
}
