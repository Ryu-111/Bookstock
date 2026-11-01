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

/**
 * よく読む著者。読了した記録の数に評価を加味して点数を付け、2冊以上の著者を上位から返す。
 * 評価なしは0、★4は+0.5、★5は+1、★1・2は-0.5。
 */
export function favoriteAuthors(data: ExportFile, limit = 3): string[] {
  const books = new Map(data.books.map((b) => [b.id, b]));
  const score = new Map<string, { points: number; count: number }>();
  for (const r of data.records) {
    if (r.status !== 'finished' && r.status !== 'reading') continue;
    const book = books.get(r.bookId);
    if (!book) continue;
    const bonus =
      r.rating === 5
        ? 1
        : r.rating === 4
          ? 0.5
          : r.rating && r.rating <= 2
            ? -0.5
            : 0;
    for (const author of new Set(
      book.authors.map((a) => a.trim()).filter(Boolean),
    )) {
      const s = score.get(author) ?? { points: 0, count: 0 };
      s.points += 1 + bonus;
      s.count += 1;
      score.set(author, s);
    }
  }
  return [...score.entries()]
    .filter(([, s]) => s.count >= 2)
    .sort((a, b) => b[1].points - a[1].points || a[0].localeCompare(b[0], 'ja'))
    .slice(0, limit)
    .map(([author]) => author);
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
