import type {
  Book,
  ExportFile,
  Format,
  ReadingRecord,
  Status,
} from './book.js';

export type ShelfSort = 'recent' | 'title';

export interface ShelfFilter {
  /** 既定は更新日の新しい順 */
  sort?: ShelfSort;
  format?: Format;
  status?: Status;
  tag?: string;
  text?: string;
}

export interface ShelfItem {
  record: ReadingRecord;
  book: Book;
}

/** 大文字小文字・全角半角・ひらがなとカタカナの違いをそろえる。 */
function fold(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3041-\u3096]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) + 0x60),
    );
}

/** 本棚に出す記録を絞り込み、更新日順（またはタイトル順。読み仮名があれば読みで）に並べる。 */
export function filterRecords(
  data: ExportFile,
  filter: ShelfFilter,
): ShelfItem[] {
  const books = new Map(data.books.map((b) => [b.id, b]));
  const words = fold(filter.text ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const items: ShelfItem[] = [];
  for (const record of data.records) {
    const book = books.get(record.bookId);
    if (!book) continue;
    if (filter.format && record.format !== filter.format) continue;
    if (filter.status && record.status !== filter.status) continue;
    if (filter.tag && !record.tags.includes(filter.tag)) continue;
    if (words.length > 0) {
      const haystack = fold(
        [book.title, book.titleKana ?? '', ...book.authors].join(' '),
      );
      if (!words.every((w) => haystack.includes(w))) continue;
    }
    items.push({ record, book });
  }
  const byTitle = (a: ShelfItem, b: ShelfItem) =>
    (a.book.titleKana ?? a.book.title).localeCompare(
      b.book.titleKana ?? b.book.title,
      'ja',
    );
  return items.sort((a, b) =>
    filter.sort === 'title'
      ? byTitle(a, b) || b.record.updatedAt.localeCompare(a.record.updatedAt)
      : b.record.updatedAt.localeCompare(a.record.updatedAt) || byTitle(a, b),
  );
}

/** 記録に付いているタグを、よく使う順に返す。 */
export function allTags(data: ExportFile): string[] {
  const counts = new Map<string, number>();
  for (const r of data.records)
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([t]) => t);
}
