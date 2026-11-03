import type { Book, ExportFile } from '../domain/book.js';
import { fetchText } from './http.js';
import type { FetchFailure, FetchLike } from './http.js';
import { ndlIsbnUrl, parseNdl } from './ndl.js';
import type { XmlParser } from './ndl.js';
import { openbdUrl, parseOpenbd } from './openbd.js';

/** 分類を補完する対象。ISBNがあって、NDCもCコードもなく、記録のある本。 */
export function classTargets(data: ExportFile): Book[] {
  const used = new Set(data.records.map((r) => r.bookId));
  return data.books.filter(
    (b) => used.has(b.id) && b.isbn13 && !b.ndc && !b.ccode,
  );
}

export interface EnrichDeps {
  fetch: FetchLike;
  parseXml: XmlParser;
  /** 1件ずつ間隔を空ける（NDL用） */
  throttle: <T>(fn: () => Promise<T>) => Promise<T>;
  timeoutMs?: number;
}

export type EnrichPatch = Pick<Book, 'ndc' | 'ccode' | 'pageCount'>;

export interface EnrichProgress {
  done: number;
  total: number;
  filled: number;
}

export type EnrichResult =
  | {
      kind: 'done';
      filled: number;
      total: number;
      /** NDLサーチに届かなかった理由（届いたならundefined） */
      ndlFailure?: FetchFailure;
    }
  | { kind: 'aborted'; filled: number; done: number }
  | { kind: 'unreachable'; reason: FetchFailure; filled: number };

/** openBDに一度に問い合わせるISBNの数。 */
const OPENBD_BATCH = 100;
/** 最初からこの回数続けて通信に失敗したら、NDLに届かないとみなして止める。 */
const GIVE_UP_AFTER = 3;

/**
 * 分類を補う。送るのはISBNだけ。
 * 1. openBDにまとめて問い合わせ、Cコード（と空のページ数）を取る
 * 2. 残った本をNDLサーチで1冊ずつ引き、NDCを取る。届かなければ（CORSなど）そこで止める
 * 取れた本は1冊ずつ onBook で保存する。
 */
export async function enrichClasses(
  books: Book[],
  deps: EnrichDeps,
  onBook: (id: string, patch: EnrichPatch) => Promise<void>,
  onProgress: (p: EnrichProgress) => void,
  signal?: AbortSignal,
): Promise<EnrichResult> {
  const total = books.length;
  let filled = 0;
  let openbdFailure: FetchFailure | undefined;
  let openbdReached = false;
  const remaining: Book[] = [];

  for (let start = 0; start < total; start += OPENBD_BATCH) {
    if (signal?.aborted) return { kind: 'aborted', filled, done: start };
    const chunk = books.slice(start, start + OPENBD_BATCH);
    const isbns = chunk.flatMap((b) => (b.isbn13 ? [b.isbn13] : []));
    const result = await fetchText(
      openbdUrl(isbns),
      deps.fetch,
      deps.timeoutMs,
    );
    if (!result.ok) {
      openbdFailure = result.reason;
      remaining.push(...chunk);
      continue;
    }
    openbdReached = true;
    const found = new Map(parseOpenbd(result.text).map((b) => [b.isbn13, b]));
    for (const book of chunk) {
      const match = found.get(book.isbn13);
      const patch: EnrichPatch = {};
      if (match?.ndc) patch.ndc = match.ndc;
      if (match?.ccode) patch.ccode = match.ccode;
      if (!book.pageCount && match?.pageCount)
        patch.pageCount = match.pageCount;
      if (patch.ndc || patch.ccode) {
        await onBook(book.id, patch);
        filled++;
      } else remaining.push(book);
    }
    onProgress({
      done: Math.min(start + OPENBD_BATCH, total) - remaining.length,
      total,
      filled,
    });
  }

  let succeeded = 0;
  let failures = 0;
  const base = total - remaining.length;
  for (let i = 0; i < remaining.length; i++) {
    if (signal?.aborted) return { kind: 'aborted', filled, done: base + i };
    const book = remaining[i];
    if (!book?.isbn13) continue;
    const isbn = book.isbn13;
    const result = await deps.throttle(() =>
      fetchText(ndlIsbnUrl(isbn), deps.fetch, deps.timeoutMs),
    );
    if (!result.ok) {
      if (result.reason !== 'http' || result.status !== 404) failures++;
      if (succeeded === 0 && failures >= GIVE_UP_AFTER) {
        if (!openbdReached && openbdFailure)
          return { kind: 'unreachable', reason: result.reason, filled };
        return { kind: 'done', filled, total, ndlFailure: result.reason };
      }
    } else {
      succeeded++;
      const found = parseNdl(result.text, deps.parseXml);
      const match = found.find((b) => b.isbn13 === isbn) ?? found[0];
      if (match?.ndc) {
        const patch: EnrichPatch = { ndc: match.ndc };
        if (!book.pageCount && match.pageCount)
          patch.pageCount = match.pageCount;
        await onBook(book.id, patch);
        filled++;
      }
    }
    onProgress({ done: base + i + 1, total, filled });
  }
  return { kind: 'done', filled, total };
}
