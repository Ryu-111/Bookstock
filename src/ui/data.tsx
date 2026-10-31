import { useState } from 'preact/hooks';
import type { ExportFile } from '../domain/book.js';
import type { ImportMode } from '../storage/db.js';
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
}: {
  data: ExportFile;
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
      <h2>データ</h2>
      <p>記録はこのブラウザにだけ保存されます。定期的に書き出してください。</p>
      <button type="button" onClick={() => download(data)}>
        JSONで書き出す
      </button>
      <fieldset>
        <legend>読み込み方</legend>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === 'merge'}
            onChange={() => setMode('merge')}
          />
          統合（同じIDは上書き）
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === 'replace'}
            onChange={() => setMode('replace')}
          />
          置換
        </label>
      </fieldset>
      <input
        type="file"
        accept="application/json,.json"
        aria-label="JSONを読み込む"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void importFile(file);
        }}
      />
      {message && <p role="status">{message}</p>}
    </section>
  );
}
