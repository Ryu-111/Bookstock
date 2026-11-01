import { useState } from 'preact/hooks';
import type { ExportFile } from '../domain/book.js';
import type { ImportMode } from '../storage/db.js';
import type { Persistence } from '../storage/settings.js';
import { Cell, Group, Segmented } from './ios.js';
import { exportFileName, parseExportFile } from '../storage/export-file.js';

function download(data: ExportFile) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(new Date());
  a.click();
  URL.revokeObjectURL(url);
}

export function DataPanel({
  data,
  onImport,
  persistence,
}: {
  data: ExportFile;
  persistence: Persistence | undefined;
  onImport: (file: ExportFile, mode: ImportMode) => Promise<void>;
}) {
  const [mode, setMode] = useState<ImportMode>('merge');
  const [message, setMessage] = useState<string>();

  async function importFile(file: File) {
    const parsed = parseExportFile(await file.text());
    if (!parsed.ok) {
      setMessage(`読み込めません: ${parsed.errors.slice(0, 5).join(' / ')}`);
      return;
    }
    if (
      mode === 'replace' &&
      !window.confirm(
        '今のデータをすべて消して、ファイルの内容に置き換えますか？',
      )
    )
      return;
    try {
      await onImport(parsed.value, mode);
      setMessage(`${parsed.value.records.length}件の記録を読み込みました`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '読み込みに失敗しました',
      );
    }
  }

  return (
    <section>
      <h1 class="large-title">設定</h1>
      <Group
        header="バックアップ"
        footer="記録はこのブラウザにだけ保存されます。アプリを更新しても消えませんが、ブラウザのデータを消したときや、ブラウザが容量を空けるときに失われることがあります。定期的に書き出してください。iPhoneでは、Safariの共有メニューから「ホーム画面に追加」して使うと消えにくくなります。"
      >
        <div class="cell">
          <span class="cell-label">消えにくい保存</span>
          <span class="cell-value">
            {persistence === 'persisted'
              ? '有効'
              : persistence === 'best-effort'
                ? 'ブラウザの判断で消える場合あり'
                : persistence === 'unsupported'
                  ? '非対応のブラウザ'
                  : '確認中'}
          </span>
        </div>
        <div class="cell">
          <span class="cell-label">保存している記録</span>
          <span class="cell-value">
            {data.books.length}冊・{data.records.length}件
          </span>
        </div>
        <button
          type="button"
          class="cell cell-button"
          onClick={() => download(data)}
        >
          JSONで書き出す
        </button>
      </Group>
      <Group
        header="読み込み"
        footer="統合は同じIDの記録を上書きし、ほかは残します。置換は今のデータをすべて消します。"
      >
        <Cell label="読み込み方" control={false}>
          <Segmented
            label="読み込み方"
            options={[
              ['merge', '統合'],
              ['replace', '置換'],
            ]}
            value={mode}
            onChange={setMode}
          />
        </Cell>
        <label class="cell cell-button">
          JSONファイルを選ぶ
          <input
            type="file"
            class="visually-hidden"
            accept="application/json,.json"
            aria-label="JSONを読み込む"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void importFile(file);
            }}
          />
        </label>
      </Group>
      {message && (
        <p role="status" class="footnote">
          {message}
        </p>
      )}
    </section>
  );
}
