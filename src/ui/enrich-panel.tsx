import type { ExportFile } from '../domain/book.js';
import { classTargets } from '../lookup/enrich.js';
import type { EnrichRunner } from './enrich-runner.js';
import { sourceLabel, useEnrichState } from './enrich-runner.js';
import { Group } from './ios.js';

/** 設定画面: 分類の補完の状態を見て、始めたり止めたりする。補完そのものは裏で進む。 */
export function EnrichPanel({
  data,
  runner,
}: {
  data: ExportFile;
  runner: EnrichRunner;
}) {
  const state = useEnrichState(runner);
  const targets = classTargets(data);
  const { progress, message } = state;

  return (
    <Group
      header="分類を補完"
      label="分類を補完"
      footer="ISBNだけをopenBD・楽天ブックス（設定した場合）・国立国会図書館サーチに送り、分類やジャンルを取得します。統計の「読書マップ」とタイプ診断に使います。楽天と国立国会図書館サーチには2秒に1冊ずつ問い合わせます。起動時に1日1回、裏で自動に進みます。ほかの画面に移っても続きます。"
    >
      <div class="cell">
        <span class="cell-label">分類のない本</span>
        <span class="cell-value">{targets.length}冊</span>
      </div>
      {state.running && progress && (
        <div class="cell">
          <span class="cell-label">{sourceLabel[progress.source]}</span>
          <span class="cell-value" role="status">
            確認中 {progress.done}/{progress.total}冊・補完{progress.filled}冊
          </span>
        </div>
      )}
      {state.running ? (
        <button
          type="button"
          class="cell cell-button destructive"
          onClick={() => runner.stop()}
        >
          中止
        </button>
      ) : (
        <button
          type="button"
          class="cell cell-button"
          disabled={targets.length === 0}
          onClick={() => void runner.start(targets)}
        >
          いま補完する
        </button>
      )}
      {message && !state.running && (
        <div class="cell">
          <span role={message.error ? 'alert' : 'status'} class="footnote">
            {message.text}
          </span>
        </div>
      )}
    </Group>
  );
}
