import type { Book, ExportFile } from '../domain/book.js';
import { fetchText } from './http.js';
import type { FetchFailure, FetchLike } from './http.js';
import { ndlIsbnUrl, parseNdl } from './ndl.js';
import type { XmlParser } from './ndl.js';

/** 分類（NDC）を補完する対象。ISBNがあってNDCがなく、記録のある本。 */
export function ndcTargets(data: ExportFile): Book[] {
  const used = new Set(data.records.map((r) => r.bookId));
  return data.books.filter((b) => used.has(b.id) && b.isbn13 && !b.ndc);
}

export interface EnrichDeps {
  fetch: FetchLike;
  parseXml: XmlParser;
  throttle: <T>(fn: () => Promise<T>) => Promise<T>;
  timeoutMs?: number;
}

export interface EnrichProgress {
  done: number;
  total: number;
  filled: number;
}

export type EnrichResult =
  | { kind: 'done'; filled: number; total: number }
  | { kind: 'aborted'; filled: number; done: number }
  | { kind: 'unreachable'; reason: FetchFailure; filled: number };

/** 最初からこの回数続けて通信に失敗したら、NDLに届かないとみなして止める。 */
const GIVE_UP_AFTER = 3;

/**
 * NDLサーチでISBNを引き、NDC（と空のページ数）を補う。1冊ずつ onBook で保存する。
 * 送るのはISBNだけ。
 */
export async function enrichNdc(
  books: Book[],
  deps: EnrichDeps,
  onBook: (book: Book) => Promise<void>,
  onProgress: (p: EnrichProgress) => void,
  signal?: AbortSignal,
): Promise<EnrichResult> {
  let filled = 0;
  let succeeded = 0;
  let failures = 0;
  for (let i = 0; i < books.length; i++) {
    if (signal?.aborted) return { kind: 'aborted', filled, done: i };
    const book = books[i];
    if (!book?.isbn13) continue;
    const isbn = book.isbn13;
    const result = await deps.throttle(() =>
      fetchText(ndlIsbnUrl(isbn), deps.fetch, deps.timeoutMs),
    );
    if (!result.ok) {
      if (result.reason !== 'http' || result.status !== 404) failures++;
      if (succeeded === 0 && failures >= GIVE_UP_AFTER)
        return { kind: 'unreachable', reason: result.reason, filled };
    } else {
      succeeded++;
      const found = parseNdl(result.text, deps.parseXml);
      const match = found.find((b) => b.isbn13 === isbn) ?? found[0];
      if (match?.ndc) {
        const next: Book = { ...book, ndc: match.ndc };
        if (!book.pageCount && match.pageCount)
          next.pageCount = match.pageCount;
        await onBook(next);
        filled++;
      }
    }
    onProgress({ done: i + 1, total: books.length, filled });
  }
  return { kind: 'done', filled, total: books.length };
}
