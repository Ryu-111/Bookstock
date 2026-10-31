import type { ExportFile } from '../domain/book.js';
import { formatLabel, statusLabel } from './labels.js';

export function Library({
  data,
  onDelete,
}: {
  data: ExportFile;
  onDelete: (recordId: string) => Promise<void>;
}) {
  const books = new Map(data.books.map((b) => [b.id, b]));
  const records = [...data.records].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <section>
      <h2>記録（{records.length}件）</h2>
      {records.length === 0 ? (
        <p>まだ記録がありません。</p>
      ) : (
        <ul class="records">
          {records.map((r) => {
            const book = books.get(r.bookId);
            return (
              <li key={r.id}>
                <strong>{book?.title ?? '（不明な本）'}</strong>{' '}
                <span>
                  {formatLabel[r.format]}
                  {r.platform ? `（${r.platform}）` : ''} /{' '}
                  {statusLabel[r.status]}
                  {r.startedAt && r.status === 'reading'
                    ? ` / ${r.startedAt}から`
                    : ''}
                  {r.finishedAt ? ` / ${r.finishedAt}読了` : ''}
                  {r.totalMinutes ? ` / ${r.totalMinutes}分` : ''}
                </span>{' '}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `「${book?.title ?? ''}」の記録を削除しますか？`,
                      )
                    )
                      void onDelete(r.id);
                  }}
                >
                  削除
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
