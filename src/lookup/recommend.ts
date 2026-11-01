import type { BookCandidate, ExportFile } from '../domain/book.js';
import {
  favoriteAuthors,
  nextVolume,
  notOwned,
  ownedIndex,
  seriesLeads,
} from '../domain/recommend.js';
import { fetchText } from './http.js';
import type { FetchFailure, FetchLike } from './http.js';
import { parseRakuten, parseRakutenGenres, rakutenUrl } from './rakuten.js';
import type { RakutenConfig, RakutenGenre, RakutenQuery } from './rakuten.js';

/** 楽天の制限（1アプリIDにつき1秒1回）を守るため、呼び出しを間隔を空けて順に実行する。 */
export function createThrottle(
  intervalMs: number,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = () => Date.now(),
) {
  let last = -Infinity;
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + intervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

export interface RecommendDeps {
  fetch: FetchLike;
  rakuten: RakutenConfig;
  throttle: <T>(fn: () => Promise<T>) => Promise<T>;
  /** 同じ問い合わせの結果を使い回す（キーにIDとキーは含めない） */
  cache: Map<string, string>;
  timeoutMs?: number;
}

const NOT_FOUND = '\u0000not_found';

export type Fetched =
  | { ok: true; body: string }
  | { ok: false; reason: FetchFailure | 'not_found' };

async function get(query: RakutenQuery, deps: RecommendDeps): Promise<Fetched> {
  const key = JSON.stringify({ e: deps.rakuten.endpoint, q: query });
  const cached = deps.cache.get(key);
  if (cached === NOT_FOUND) return { ok: false, reason: 'not_found' };
  if (cached !== undefined) return { ok: true, body: cached };
  const result = await deps.throttle(() =>
    fetchText(rakutenUrl(deps.rakuten, query), deps.fetch, deps.timeoutMs),
  );
  if (!result.ok) {
    if (result.status === 404) {
      // 該当なしも覚えておき、同じ問い合わせを繰り返さない
      deps.cache.set(key, NOT_FOUND);
      return { ok: false, reason: 'not_found' };
    }
    return { ok: false, reason: result.reason };
  }
  deps.cache.set(key, result.text);
  return { ok: true, body: result.text };
}

export interface AuthorPick {
  author: string;
  books: BookCandidate[];
}

/** よく読む著者の、本棚にない本（新しい順）。著者ごとに届いた順で onAuthor を呼ぶ。 */
export async function recommendByAuthors(
  data: ExportFile,
  deps: RecommendDeps,
  onAuthor: (pick: AuthorPick) => void,
): Promise<FetchFailure | 'not_found' | null> {
  const owned = ownedIndex(data);
  let failure: FetchFailure | 'not_found' | null = null;
  for (const author of favoriteAuthors(data)) {
    const r = await get({ author, sort: '-releaseDate' }, deps);
    if (!r.ok) {
      if (r.reason !== 'not_found') failure = r.reason;
      continue;
    }
    const books = notOwned(parseRakuten(r.body), owned, 10);
    if (books.length > 0) onAuthor({ author, books });
  }
  return failure;
}

/** 読んだシリーズの、本棚にない次の巻。 */
export async function recommendSeries(
  data: ExportFile,
  deps: RecommendDeps,
  onBook: (book: BookCandidate) => void,
): Promise<FetchFailure | 'not_found' | null> {
  const owned = ownedIndex(data);
  let failure: FetchFailure | 'not_found' | null = null;
  for (const lead of seriesLeads(data)) {
    const r = await get({ title: lead.base, sort: '-releaseDate' }, deps);
    if (!r.ok) {
      if (r.reason !== 'not_found') failure = r.reason;
      continue;
    }
    const next = nextVolume(lead, parseRakuten(r.body), owned);
    if (next) onBook(next);
  }
  return failure;
}

/** 本（ジャンル001）か、そのジャンルの売れている順。下位ジャンルの一覧も返す。 */
export async function recommendRanking(
  data: ExportFile,
  genreId: string,
  deps: RecommendDeps,
): Promise<
  | { ok: true; books: BookCandidate[]; genres: RakutenGenre[] }
  | { ok: false; reason: FetchFailure | 'not_found' }
> {
  const r = await get({ genreId, sort: 'sales', genreInfo: true }, deps);
  if (!r.ok) return r;
  return {
    ok: true,
    books: notOwned(parseRakuten(r.body), ownedIndex(data), 20),
    genres: parseRakutenGenres(r.body),
  };
}
