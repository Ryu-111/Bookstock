import type { BookCandidate, BookSource } from '../domain/book.js';
import { toIsbn13 } from '../domain/isbn.js';
import { googleIsbnUrl, googleSearchUrl, parseGoogle } from './google.js';
import { fetchText } from './http.js';
import type { FetchFailure, FetchLike, SearchField } from './http.js';
import { ndlIsbnUrl, ndlSearchUrl, parseNdl } from './ndl.js';
import type { XmlParser } from './ndl.js';
import { openbdUrl, parseOpenbd } from './openbd.js';
import {
  isRakutenAuthError,
  parseRakuten,
  rakutenError,
  rakutenUrl,
} from './rakuten.js';
import type { RakutenConfig } from './rakuten.js';

export interface LookupDeps {
  fetch: FetchLike;
  parseXml: XmlParser;
  timeoutMs?: number;
  /** 設定画面で楽天のIDが入力されていれば、楽天を最初に引く */
  rakuten?: RakutenConfig | null;
}

export type Outcome = 'found' | 'not_found' | 'auth' | FetchFailure;
export type RemoteSource = Exclude<BookSource, 'manual'>;
export interface Attempt {
  source: RemoteSource;
  outcome: Outcome;
  /** APIが返したエラーの説明（楽天のIDエラーなど） */
  detail?: string;
}

interface SourceResult {
  books: BookCandidate[];
  attempt: Attempt;
}

async function query(
  source: RemoteSource,
  url: string,
  parse: (body: string) => BookCandidate[],
  deps: LookupDeps,
): Promise<SourceResult> {
  const result = await fetchText(url, deps.fetch, deps.timeoutMs);
  if (!result.ok) {
    if (source === 'rakuten') {
      const message = rakutenError(result.body, [
        deps.rakuten?.applicationId ?? '',
        deps.rakuten?.accessKey ?? '',
      ]);
      // 該当なしは 404 not_found で返る
      const outcome: Outcome =
        result.status === 404
          ? 'not_found'
          : result.reason === 'http' &&
              isRakutenAuthError(result.status, message)
            ? 'auth'
            : result.reason;
      const attempt: Attempt = { source, outcome };
      const detail = [
        result.status ? `HTTP ${result.status}` : undefined,
        message,
      ]
        .filter(Boolean)
        .join(': ');
      if (detail) attempt.detail = detail;
      return { books: [], attempt };
    }
    return { books: [], attempt: { source, outcome: result.reason } };
  }
  const books = parse(result.text);
  return {
    books,
    attempt: { source, outcome: books.length > 0 ? 'found' : 'not_found' },
  };
}

/** 空の項目だけを補う。 */
function fill(base: BookCandidate, extra: BookCandidate): BookCandidate {
  const merged = { ...base };
  if (merged.authors.length === 0 && extra.authors.length > 0)
    merged.authors = extra.authors;
  for (const key of [
    'titleKana',
    'publisher',
    'publishedDate',
    'coverUrl',
    'pageCount',
    'ndc',
  ] as const) {
    if (merged[key] === undefined && extra[key] !== undefined)
      Object.assign(merged, { [key]: extra[key] });
  }
  return merged;
}

function complete(book: BookCandidate | null): boolean {
  return Boolean(book?.coverUrl && book.pageCount);
}

export type IsbnLookup =
  | { ok: true; book: BookCandidate | null; attempts: Attempt[] }
  | { ok: false; error: 'invalid_isbn' };

type Source = [RemoteSource, string, (body: string) => BookCandidate[]];

/** ISBNで（楽天 →）openBD → NDL → Google の順に引き、足りない項目を後の結果で補う。 */
export async function lookupIsbn(
  input: string,
  deps: LookupDeps,
): Promise<IsbnLookup> {
  const isbn13 = toIsbn13(input);
  if (!isbn13) return { ok: false, error: 'invalid_isbn' };
  const sources: Source[] = [
    ...(deps.rakuten
      ? [
          [
            'rakuten',
            rakutenUrl(deps.rakuten, { isbn: isbn13 }),
            parseRakuten,
          ] satisfies Source,
        ]
      : []),
    ['openbd', openbdUrl(isbn13), parseOpenbd],
    ['ndl', ndlIsbnUrl(isbn13), (body) => parseNdl(body, deps.parseXml)],
    ['google', googleIsbnUrl(isbn13), parseGoogle],
  ];
  let book: BookCandidate | null = null;
  const attempts: Attempt[] = [];
  for (const [source, url, parse] of sources) {
    if (complete(book)) break;
    const result = await query(source, url, parse, deps);
    attempts.push(result.attempt);
    const found =
      result.books.find((b) => b.isbn13 === isbn13) ?? result.books[0];
    if (!found) continue;
    book = book ? fill(book, found) : { ...found, isbn13 };
  }
  return { ok: true, book, attempts };
}

function key(book: BookCandidate): string {
  return book.isbn13 ?? `${book.title}|${book.authors.join(',')}`;
}

export type { SearchField } from './http.js';

/** タイトルか著者で（楽天・）NDL・Googleを並行に検索し、重複をまとめる。 */
export async function searchBooks(
  input: string,
  field: SearchField,
  deps: LookupDeps,
): Promise<{ books: BookCandidate[]; attempts: Attempt[] }> {
  const q = input.trim();
  if (!q) return { books: [], attempts: [] };
  const results = await Promise.all([
    ...(deps.rakuten
      ? [
          query(
            'rakuten',
            rakutenUrl(
              deps.rakuten,
              field === 'author' ? { author: q } : { title: q },
            ),
            parseRakuten,
            deps,
          ),
        ]
      : []),
    query(
      'ndl',
      ndlSearchUrl(field, q),
      (body) => parseNdl(body, deps.parseXml),
      deps,
    ),
    query('google', googleSearchUrl(field, q), parseGoogle, deps),
  ]);
  const byKey = new Map<string, BookCandidate>();
  for (const book of results.flatMap((r) => r.books)) {
    const k = key(book);
    const existing = byKey.get(k);
    byKey.set(k, existing ? fill(existing, book) : book);
  }
  return {
    books: [...byKey.values()],
    attempts: results.map((r) => r.attempt),
  };
}

/** 設定画面の接続テスト。楽天だけを1件引いて結果を返す。 */
export async function testRakuten(
  config: RakutenConfig,
  deps: Omit<LookupDeps, 'rakuten'>,
  isbn = '9784003101018',
): Promise<Attempt> {
  const result = await query(
    'rakuten',
    rakutenUrl(config, { isbn }),
    parseRakuten,
    // エラー文の伏せ字に使う
    { ...deps, rakuten: config },
  );
  return result.attempt;
}
