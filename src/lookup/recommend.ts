import type { BookCandidate, ExportFile } from '../domain/book.js';
import {
  favoriteAuthors,
  favoriteGenres,
  nextVolume,
  notOwned,
  ownedIndex,
  seriesLeads,
  titleKey,
  withoutSeries,
} from '../domain/recommend.js';
import type { Candidate, GenreTaste, Origin } from '../domain/recommend.js';
import { fetchText } from './http.js';
import type { FetchFailure, FetchLike } from './http.js';
import {
  isRakutenAuthError,
  parseRakuten,
  parseRakutenGenres,
  parseRakutenItems,
  rakutenUrl,
} from './rakuten.js';
import type {
  RakutenConfig,
  RakutenGenre,
  RakutenItem,
  RakutenQuery,
} from './rakuten.js';

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
  | {
      ok: false;
      reason: FetchFailure | 'not_found';
      /** IDや許可サイトの設定の誤りによる失敗か */
      auth?: boolean;
    };

/** 楽天ブックスに問い合わせる。結果（該当なしも）をキャッシュし、throttleで間隔を空ける。 */
export async function rakutenGet(
  query: RakutenQuery,
  deps: Pick<
    RecommendDeps,
    'fetch' | 'rakuten' | 'throttle' | 'cache' | 'timeoutMs'
  >,
): Promise<Fetched> {
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
    return {
      ok: false,
      reason: result.reason,
      ...(isRakutenAuthError(result.status, result.body) ? { auth: true } : {}),
    };
  }
  deps.cache.set(key, result.text);
  return { ok: true, body: result.text };
}

export interface AuthorPick {
  author: string;
  books: BookCandidate[];
  /** 点数付けに使う候補（ジャンルIDつき） */
  candidates: Candidate[];
}

/**
 * 漫画・シリーズの巻・本棚にある本を除いて、表示する本と点数付けの候補を作る。
 * origin は並び（0始まり）を受け取って作る。
 */
function pick(
  items: RakutenItem[],
  data: ExportFile,
  limit: number,
  origin: (rank: number) => Origin,
): { books: BookCandidate[]; candidates: Candidate[] } {
  const books = notOwned(
    withoutSeries(items.map((i) => i.book)),
    ownedIndex(data),
    limit,
  );
  const shown = new Set(books);
  const candidates = items.flatMap((item, rank) =>
    shown.has(item.book)
      ? [{ book: item.book, genreIds: item.genreIds, origin: origin(rank) }]
      : [],
  );
  return { books, candidates };
}

/** よく読む著者の、本棚にない本（新しい順）。著者ごとに届いた順で onAuthor を呼ぶ。 */
export async function recommendByAuthors(
  data: ExportFile,
  deps: RecommendDeps,
  onAuthor: (pick: AuthorPick) => void,
): Promise<FetchFailure | 'not_found' | null> {
  let failure: FetchFailure | 'not_found' | null = null;
  for (const author of favoriteAuthors(data)) {
    const r = await rakutenGet({ author, sort: '-releaseDate' }, deps);
    if (!r.ok) {
      if (r.reason !== 'not_found') failure = r.reason;
      continue;
    }
    const { books, candidates } = pick(
      parseRakutenItems(r.body, { skipComics: true }),
      data,
      10,
      () => ({ kind: 'author', author }),
    );
    if (books.length > 0) onAuthor({ author, books, candidates });
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
    const r = await rakutenGet(
      { title: lead.base, sort: '-releaseDate' },
      deps,
    );
    if (!r.ok) {
      if (r.reason !== 'not_found') failure = r.reason;
      continue;
    }
    const next = nextVolume(
      lead,
      parseRakuten(r.body, { skipComics: true }),
      owned,
    );
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
  | {
      ok: true;
      books: BookCandidate[];
      genres: RakutenGenre[];
      candidates: Candidate[];
    }
  | { ok: false; reason: FetchFailure | 'not_found' }
> {
  // 漫画とシリーズの巻を除くと減るので、多めに取る
  const r = await rakutenGet(
    { genreId, sort: 'sales', genreInfo: true, hits: 30 },
    deps,
  );
  if (!r.ok) return { ok: false, reason: r.reason };
  return {
    ok: true,
    ...pick(
      parseRakutenItems(r.body, { skipComics: true }),
      data,
      20,
      (rank) => ({
        kind: 'ranking',
        rank,
      }),
    ),
    // 漫画のジャンルは選べないようにする
    genres: parseRakutenGenres(r.body).filter(
      (g) => !/漫画|コミック|ボーイズラブ/.test(g.name),
    ),
  };
}

/**
 * ジャンル名（上位 > 下位）を、楽天ブックスのジャンルIDに読み替える。
 * 本（001）から下位の一覧をたどる。一覧はキャッシュする。見つからなければnull。
 */
export async function resolveGenreId(
  path: string,
  deps: RecommendDeps,
): Promise<string | null> {
  let id = '001';
  for (const name of path.split(' > ')) {
    const r = await rakutenGet({ genreId: id, genreInfo: true }, deps);
    if (!r.ok) return null;
    const child = parseRakutenGenres(r.body).find(
      (g) => titleKey(g.name) === titleKey(name),
    );
    if (!child) return null;
    id = child.id;
  }
  return id === '001' ? null : id;
}

export interface GenrePick {
  genre: GenreTaste & { id: string };
  books: BookCandidate[];
  candidates: Candidate[];
}

/**
 * よく読むジャンルの、売れている本。ジャンルごとに届いた順で onGenre を呼ぶ。
 * IDに読み替えられたジャンルを返す（点数付けに使う）。送るのはジャンルIDだけ。
 */
export async function recommendGenres(
  data: ExportFile,
  deps: RecommendDeps,
  onGenre: (pick: GenrePick) => void,
): Promise<{ genres: GenreTaste[]; failure: FetchFailure | null }> {
  const genres: GenreTaste[] = [];
  let failure: FetchFailure | null = null;
  for (const taste of favoriteGenres(data)) {
    const id = await resolveGenreId(taste.key, deps);
    if (!id) {
      genres.push(taste);
      continue;
    }
    const genre = { ...taste, id };
    genres.push(genre);
    const r = await rakutenGet({ genreId: id, sort: 'sales', hits: 30 }, deps);
    if (!r.ok) {
      if (r.reason !== 'not_found') failure = r.reason;
      continue;
    }
    const { books, candidates } = pick(
      parseRakutenItems(r.body, { skipComics: true }),
      data,
      12,
      (rank) => ({ kind: 'genre', genre: taste.key, rank }),
    );
    if (books.length > 0) onGenre({ genre, books, candidates });
  }
  return { genres, failure };
}
