import type { Book, ExportFile } from '../domain/book.js';
import {
  BROAD_GENRE,
  GENRE_SEPARATOR,
  rakutenGenreToNdc,
} from '../domain/ndc.js';
import { fetchText } from './http.js';
import type { FetchFailure, FetchLike } from './http.js';
import { ndlIsbnUrl, parseNdl } from './ndl.js';
import type { XmlParser } from './ndl.js';
import { openbdUrl, parseOpenbd } from './openbd.js';
import type { RakutenConfig } from './rakuten.js';
import { parseRakutenGenreIds, parseRakutenGenres } from './rakuten.js';
import { rakutenGet } from './recommend.js';
import type { Fetched } from './recommend.js';

/** 分類を補完する対象。ISBNがあって、分類の手がかり（NDC・Cコード・楽天のジャンル）がなく、記録のある本。 */
export function classTargets(data: ExportFile): Book[] {
  const used = new Set(data.records.map((r) => r.bookId));
  return data.books.filter(
    (b) => used.has(b.id) && b.isbn13 && !b.ndc && !b.ccode && !b.rakutenGenre,
  );
}

export interface EnrichDeps {
  fetch: FetchLike;
  parseXml: XmlParser;
  /** 1冊ごとの間隔を空ける（楽天・NDL） */
  pace: <T>(fn: () => Promise<T>) => Promise<T>;
  /** 設定されていれば、楽天ブックスのジャンルでも補う */
  rakuten?: {
    config: RakutenConfig;
    /** 楽天の制限（1秒1回）を、おすすめなど他の画面と共有して守る */
    throttle: <T>(fn: () => Promise<T>) => Promise<T>;
    cache: Map<string, string>;
  };
  timeoutMs?: number;
}

export type EnrichPatch = Pick<
  Book,
  'ndc' | 'ccode' | 'rakutenGenre' | 'pageCount'
>;

export type EnrichSource = 'openbd' | 'rakuten' | 'ndl';
export type EnrichFailure = FetchFailure | 'auth';

/** いま問い合わせている取得元と、その段での進み具合。 */
export interface EnrichProgress {
  source: EnrichSource;
  done: number;
  total: number;
  filled: number;
}

export interface EnrichResult {
  kind: 'done' | 'aborted';
  filled: number;
  total: number;
  /** 取得元ごとの補完した冊数 */
  bySource: Record<EnrichSource, number>;
  /** 届かなかった取得元と理由（auth は楽天のID・許可サイトの設定エラー） */
  unreachable: Partial<Record<EnrichSource, EnrichFailure>>;
}

/** openBDに一度に問い合わせるISBNの数。 */
const OPENBD_BATCH = 100;
/** 最初からこの回数続けて通信に失敗したら、その取得元に届かないとみなして止める。 */
const GIVE_UP_AFTER = 3;

type Step =
  | { ok: true; patch: EnrichPatch | null }
  | { ok: false; reason: EnrichFailure };

function failed(r: Extract<Fetched, { ok: false }>): Step {
  if (r.reason === 'not_found') return { ok: true, patch: null };
  return { ok: false, reason: r.auth ? 'auth' : r.reason };
}

/** ジャンルIDの各階層（001004 → 001004008 → …）。 */
function genreLevels(id: string): string[] {
  const levels: string[] = [];
  for (let n = 6; n <= id.length; n += 3) levels.push(id.slice(0, n));
  return levels;
}

/**
 * 楽天ブックスでISBNを引き、ジャンル名（上位 > 下位）を作る。
 * 名前は上位ジャンルの下位一覧（genreInformationFlag=1）から読む。この一覧はキャッシュする。
 * 分類に使える名前が出た階層で止める。
 */
async function rakutenStep(
  isbn: string,
  rakuten: NonNullable<EnrichDeps['rakuten']>,
  deps: EnrichDeps,
): Promise<Step> {
  const r = {
    fetch: deps.fetch,
    rakuten: rakuten.config,
    throttle: rakuten.throttle,
    cache: rakuten.cache,
    ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
  };
  const found = await rakutenGet({ isbn }, r);
  if (!found.ok) return failed(found);
  for (const id of parseRakutenGenreIds(found.body, isbn)) {
    const names: string[] = [];
    for (const level of genreLevels(id)) {
      const parent = await rakutenGet(
        { genreId: level.slice(0, -3), genreInfo: true },
        r,
      );
      if (!parent.ok) {
        if (parent.reason === 'not_found') break;
        return failed(parent);
      }
      const name = parseRakutenGenres(parent.body).find(
        (g) => g.id === level,
      )?.name;
      if (!name) break;
      names.push(name);
      if (!BROAD_GENRE.test(name) && rakutenGenreToNdc(name)) break;
    }
    const path = names.join(GENRE_SEPARATOR).slice(0, 200);
    if (rakutenGenreToNdc(path))
      return { ok: true, patch: { rakutenGenre: path } };
  }
  return { ok: true, patch: null };
}

async function ndlStep(
  book: Book,
  isbn: string,
  deps: EnrichDeps,
): Promise<Step> {
  const result = await fetchText(ndlIsbnUrl(isbn), deps.fetch, deps.timeoutMs);
  if (!result.ok) {
    if (result.reason === 'http' && result.status === 404)
      return { ok: true, patch: null };
    return { ok: false, reason: result.reason };
  }
  const found = parseNdl(result.text, deps.parseXml);
  const match = found.find((b) => b.isbn13 === isbn) ?? found[0];
  if (!match?.ndc) return { ok: true, patch: null };
  const patch: EnrichPatch = { ndc: match.ndc };
  if (!book.pageCount && match.pageCount) patch.pageCount = match.pageCount;
  return { ok: true, patch };
}

/**
 * 分類を補う。送るのはISBNだけ。
 * 1. openBDにまとめて問い合わせ、Cコード（と空のページ数）を取る
 * 2. 楽天ブックスを設定していれば、残りを1冊ずつ引き、ジャンル名を取る
 * 3. 残りをNDLサーチで1冊ずつ引き、NDCを取る
 * 2と3は pace で間隔を空ける。IDの誤り、または最初から続けて届かなければ、その取得元だけを止める。
 * 取れた本は1冊ずつ onBook で保存する。
 */
export async function enrichClasses(
  books: Book[],
  deps: EnrichDeps,
  onBook: (id: string, patch: EnrichPatch) => Promise<void>,
  onProgress: (p: EnrichProgress) => void,
  signal?: AbortSignal,
): Promise<EnrichResult> {
  const result: EnrichResult = {
    kind: 'done',
    filled: 0,
    total: books.length,
    bySource: { openbd: 0, rakuten: 0, ndl: 0 },
    unreachable: {},
  };
  const save = async (source: EnrichSource, id: string, patch: EnrichPatch) => {
    await onBook(id, patch);
    result.filled++;
    result.bySource[source]++;
  };

  let remaining: Book[] = [];
  let openbdOk = false;
  for (let start = 0; start < books.length; start += OPENBD_BATCH) {
    if (signal?.aborted) return { ...result, kind: 'aborted' };
    onProgress({
      source: 'openbd',
      done: start,
      total: books.length,
      filled: result.filled,
    });
    const chunk = books.slice(start, start + OPENBD_BATCH);
    const isbns = chunk.flatMap((b) => (b.isbn13 ? [b.isbn13] : []));
    const fetched = await fetchText(
      openbdUrl(isbns),
      deps.fetch,
      deps.timeoutMs,
    );
    if (!fetched.ok) {
      if (!openbdOk) result.unreachable.openbd = fetched.reason;
      remaining.push(...chunk);
      continue;
    }
    openbdOk = true;
    delete result.unreachable.openbd;
    const found = new Map(parseOpenbd(fetched.text).map((b) => [b.isbn13, b]));
    for (const book of chunk) {
      const match = found.get(book.isbn13);
      const patch: EnrichPatch = {};
      if (match?.ndc) patch.ndc = match.ndc;
      if (match?.ccode) patch.ccode = match.ccode;
      if (!book.pageCount && match?.pageCount)
        patch.pageCount = match.pageCount;
      if (patch.ndc || patch.ccode) await save('openbd', book.id, patch);
      else remaining.push(book);
    }
  }

  const stages: [EnrichSource, (b: Book, isbn: string) => Promise<Step>][] = [];
  const { rakuten } = deps;
  if (rakuten)
    stages.push(['rakuten', (_, isbn) => rakutenStep(isbn, rakuten, deps)]);
  stages.push(['ndl', (b, isbn) => ndlStep(b, isbn, deps)]);

  for (const [source, step] of stages) {
    const next: Book[] = [];
    let succeeded = 0;
    let failures = 0;
    for (let i = 0; i < remaining.length; i++) {
      if (signal?.aborted) return { ...result, kind: 'aborted' };
      onProgress({
        source,
        done: i,
        total: remaining.length,
        filled: result.filled,
      });
      const book = remaining[i];
      const isbn = book?.isbn13;
      if (!book || !isbn) continue;
      const r = await deps.pace(() => step(book, isbn));
      if (r.ok) {
        succeeded++;
        if (r.patch) await save(source, book.id, r.patch);
        else next.push(book);
        continue;
      }
      failures++;
      next.push(book);
      if (
        r.reason === 'auth' ||
        (succeeded === 0 && failures >= GIVE_UP_AFTER)
      ) {
        result.unreachable[source] = r.reason;
        next.push(...remaining.slice(i + 1));
        break;
      }
    }
    remaining = next;
  }
  return result;
}
