import type { BookCandidate, ExportFile } from './book.js';

/** タイトルの比較用。全角半角・空白・記号の違いをそろえる。 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      /[\s\u3000・:：、,.。!！?？「」『』()（）[\]【】〈〉《》\-－―~〜]/g,
      '',
    );
}

/** 本棚にある本の判定に使う、ISBNとタイトルの集合。 */
export function ownedIndex(data: ExportFile) {
  const isbns = new Set<string>();
  const titles = new Set<string>();
  const used = new Set(data.records.map((r) => r.bookId));
  for (const book of data.books) {
    if (!used.has(book.id)) continue;
    if (book.isbn13) isbns.add(book.isbn13);
    titles.add(titleKey(book.title));
  }
  return (book: BookCandidate) =>
    (!!book.isbn13 && isbns.has(book.isbn13)) ||
    titles.has(titleKey(book.title));
}

/** 評価による加点。評価なしは0、★4は+0.5、★5は+1、★1・2は-0.5。 */
function ratingBonus(rating: number | undefined): number {
  return rating === 5
    ? 1
    : rating === 4
      ? 0.5
      : rating && rating <= 2
        ? -0.5
        : 0;
}

export interface Affinity {
  key: string;
  /** 読んだ（読んでいる）冊数 */
  count: number;
  /** 冊数に評価を加味した点数 */
  points: number;
}

/** 読了・読書中の記録を、keysOf が返す鍵ごとに数える。2冊以上を点数順に返す。 */
function affinities(
  data: ExportFile,
  keysOf: (book: ExportFile['books'][number]) => string[],
): Affinity[] {
  const books = new Map(data.books.map((b) => [b.id, b]));
  const score = new Map<string, Affinity>();
  for (const r of data.records) {
    if (r.status !== 'finished' && r.status !== 'reading') continue;
    const book = books.get(r.bookId);
    if (!book) continue;
    for (const key of new Set(keysOf(book))) {
      const s = score.get(key) ?? { key, points: 0, count: 0 };
      s.points += 1 + ratingBonus(r.rating);
      s.count += 1;
      score.set(key, s);
    }
  }
  return [...score.values()]
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.points - a.points || a.key.localeCompare(b.key, 'ja'));
}

/** よく読む著者（点数順）。 */
export function authorAffinities(data: ExportFile): Affinity[] {
  return affinities(data, (book) =>
    book.authors.map((a) => a.trim()).filter(Boolean),
  );
}

/** よく読む著者。読了した記録の数に評価を加味して点数を付け、2冊以上の著者を上位から返す。 */
export function favoriteAuthors(data: ExportFile, limit = 3): string[] {
  return authorAffinities(data)
    .slice(0, limit)
    .map((a) => a.key);
}

/**
 * よく読む楽天ブックスのジャンル（分類の補完で保存したジャンル名、上位 > 下位）。
 * 漫画のジャンルは除く。
 */
export function favoriteGenres(data: ExportFile, limit = 3): Affinity[] {
  return affinities(data, (book) =>
    book.rakutenGenre && !/漫画|コミック|ボーイズラブ/.test(book.rakutenGenre)
      ? [book.rakutenGenre]
      : [],
  ).slice(0, limit);
}

/** おすすめの候補がどこから来たか。 */
export type Origin =
  | { kind: 'author'; author: string }
  | { kind: 'genre'; genre: string; rank: number }
  | { kind: 'ranking'; rank: number };

export interface Candidate {
  book: BookCandidate;
  /** 楽天ブックスのジャンルID（booksGenreId） */
  genreIds: string[];
  origin: Origin;
}

/** 好みのジャンル。idは楽天ブックスのジャンルID（分かれば）。 */
export interface GenreTaste extends Affinity {
  id?: string;
}

export interface Scored {
  book: BookCandidate;
  score: number;
  /** 点数の理由（画面に出す） */
  reasons: string[];
}

/** ジャンル名（上位 > 下位）の、いちばん下の名前。 */
export function leafGenre(path: string): string {
  return path.split(' > ').at(-1) ?? path;
}

/** 発売から何日以内を新刊とみなすか。 */
const NEW_DAYS = 180;

/**
 * おすすめの候補に、好みとの近さで点数を付け、高い順に返す。計算はすべて手元で行う。
 * - 著者: よく読む著者なら、その著者の点数に応じて最大3点
 * - ジャンル: よく読むジャンル（のID）に入っていれば、そのジャンルの点数に応じて最大2点
 * - 人気: 売れている順の上位ほど最大1点
 * - 新しさ: 発売から180日以内なら0.5点
 * 同じ本が複数の取得元から来たら、まとめて理由を合わせる。
 */
export function rankForYou(
  data: ExportFile,
  candidates: Candidate[],
  genres: GenreTaste[],
  now: Date,
  limit = 12,
): Scored[] {
  const owned = ownedIndex(data);
  const authors = authorAffinities(data);
  const topAuthor = authors[0]?.points ?? 1;
  const authorOf = new Map(authors.map((a) => [a.key, a]));
  const topGenre = genres[0]?.points ?? 1;

  const merged = new Map<
    string,
    { book: BookCandidate; genreIds: Set<string>; ranks: number[] }
  >();
  for (const c of candidates) {
    if (owned(c.book) || parseVolume(c.book.title)) continue;
    const key = c.book.isbn13 ?? titleKey(c.book.title);
    const m = merged.get(key) ?? {
      book: c.book,
      genreIds: new Set<string>(),
      ranks: [],
    };
    for (const id of c.genreIds) m.genreIds.add(id);
    if (c.origin.kind !== 'author') m.ranks.push(c.origin.rank);
    merged.set(key, m);
  }

  const since = now.getTime() - NEW_DAYS * 24 * 60 * 60 * 1000;
  const scored: Scored[] = [];
  for (const { book, genreIds, ranks } of merged.values()) {
    let score = 0;
    const reasons: string[] = [];
    const author = book.authors
      .map((a) => authorOf.get(a.trim()))
      .find((a) => a !== undefined);
    if (author) {
      score += 3 * Math.max(0, author.points / topAuthor);
      reasons.push(`${author.count}冊読んだ著者`);
    }
    const genre = genres.find(
      (g) => g.id && [...genreIds].some((id) => id.startsWith(g.id ?? '')),
    );
    if (genre) {
      score += 2 * Math.max(0, genre.points / topGenre);
      reasons.push(leafGenre(genre.key));
    }
    const best = Math.min(...ranks);
    if (Number.isFinite(best)) {
      score += Math.max(0, 1 - best / 30);
      if (best < 10) reasons.push(`売れ筋${best + 1}位`);
    }
    const released = book.publishedDate
      ? Date.parse(book.publishedDate.padEnd(10, '-01').slice(0, 10))
      : NaN;
    if (released >= since && released <= now.getTime()) {
      score += 0.5;
      reasons.push('新刊');
    }
    // 著者もジャンルも合わない本は、売れているだけなので出さない
    if (!author && !genre) continue;
    scored.push({ book, score, reasons });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score || a.book.title.localeCompare(b.book.title, 'ja'),
    )
    .slice(0, limit);
}

const ORDER = ['上', '中', '下'] as const;

/** タイトルから、シリーズ名と巻数を取り出す。巻数がなければnull。上・中・下は1・2・3として扱う。 */
export function parseVolume(
  title: string,
): { base: string; volume: number } | null {
  const t = title.normalize('NFKC').trim();
  const numbered =
    /^(.*?\D)[\s(]*(?:第)?(\d{1,3})(?:巻)?\)?$/.exec(t) ??
    /^(.*?\D)[\s]*(?:第)?(\d{1,3})巻[\s].*$/.exec(t);
  if (numbered?.[1] && numbered[2]) {
    const base = numbered[1].replace(/[\s(]+$/, '').trim();
    if (base) return { base, volume: Number(numbered[2]) };
  }
  const part = /^(.*?)[\s(]*(上|中|下)(?:巻)?\)?$/.exec(t);
  if (part?.[1] && part[2]) {
    const base = part[1].replace(/[\s(]+$/, '').trim();
    if (base)
      return {
        base,
        volume: ORDER.indexOf(part[2] as (typeof ORDER)[number]) + 1,
      };
  }
  return null;
}

export interface SeriesLead {
  base: string;
  /** 本棚にある一番大きい巻 */
  owned: number;
}

/** 読んだ（読んでいる）シリーズのうち、最近のものから順に返す。 */
export function seriesLeads(data: ExportFile, limit = 5): SeriesLead[] {
  const books = new Map(data.books.map((b) => [b.id, b]));
  const leads = new Map<string, SeriesLead & { at: string }>();
  for (const r of data.records) {
    const book = books.get(r.bookId);
    if (!book) continue;
    const parsed = parseVolume(book.title);
    if (!parsed) continue;
    const key = titleKey(parsed.base);
    const at = r.finishedAt ?? r.updatedAt;
    const lead = leads.get(key);
    if (!lead) leads.set(key, { base: parsed.base, owned: parsed.volume, at });
    else {
      lead.owned = Math.max(lead.owned, parsed.volume);
      if (at > lead.at) lead.at = at;
    }
  }
  return [...leads.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map(({ base, owned }) => ({ base, owned }));
}

/** 検索結果から、そのシリーズの次の巻（本棚にない最小の巻）を選ぶ。 */
export function nextVolume(
  lead: SeriesLead,
  candidates: BookCandidate[],
  owned: (book: BookCandidate) => boolean,
): BookCandidate | undefined {
  const key = titleKey(lead.base);
  return candidates
    .map((book) => ({ book, parsed: parseVolume(book.title) }))
    .filter(
      (c) =>
        c.parsed &&
        titleKey(c.parsed.base) === key &&
        c.parsed.volume > lead.owned &&
        !owned(c.book),
    )
    .sort((a, b) => (a.parsed?.volume ?? 0) - (b.parsed?.volume ?? 0))[0]?.book;
}

/** シリーズの巻（巻数・上下のある題名）を除く。続きは「シリーズの続き」で出すため。 */
export function withoutSeries(candidates: BookCandidate[]): BookCandidate[] {
  return candidates.filter((book) => !parseVolume(book.title));
}

/** 本棚にない本だけを、重複をまとめて最大limit件返す。 */
export function notOwned(
  candidates: BookCandidate[],
  owned: (book: BookCandidate) => boolean,
  limit = 12,
): BookCandidate[] {
  const seen = new Set<string>();
  const result: BookCandidate[] = [];
  for (const book of candidates) {
    const key = book.isbn13 ?? titleKey(book.title);
    if (owned(book) || seen.has(key)) continue;
    seen.add(key);
    result.push(book);
    if (result.length >= limit) break;
  }
  return result;
}
