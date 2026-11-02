import type { Book, ExportFile, ReadingRecord } from './book.js';
import { parseNdc } from './ndc.js';
import { parseVolume } from './recommend.js';
import type { Period } from './stats.js';

export interface FinishedItem {
  record: ReadingRecord & { finishedAt: string };
  book: Book;
}

/** 期間内に読了した記録（読了日のあるもの）と本の組。 */
export function finishedIn(data: ExportFile, period: Period): FinishedItem[] {
  const books = new Map(data.books.map((b) => [b.id, b]));
  const items: FinishedItem[] = [];
  for (const r of data.records) {
    if (r.status !== 'finished' || !r.finishedAt) continue;
    if (period.kind === 'year' && !r.finishedAt.startsWith(`${period.year}-`))
      continue;
    const book = books.get(r.bookId);
    if (book) items.push({ record: { ...r, finishedAt: r.finishedAt }, book });
  }
  return items.sort((a, b) =>
    b.record.finishedAt.localeCompare(a.record.finishedAt),
  );
}

// ---- カオスマップ ----

export interface MapDivision {
  code: string;
  name: string;
  items: FinishedItem[];
}

export interface MapRegion {
  /** 類（0〜9）。分類なしは -1 */
  classCode: number;
  name: string;
  count: number;
  divisions: MapDivision[];
}

/** 読了した本を、NDCの類 → 綱でまとめる。冊数の多い順。分類なしは最後。 */
export function chaosMap(data: ExportFile, period: Period): MapRegion[] {
  const regions = new Map<number, MapRegion>();
  for (const item of finishedIn(data, period)) {
    const ndc = parseNdc(item.book.ndc);
    const classCode = ndc?.classCode ?? -1;
    let region = regions.get(classCode);
    if (!region) {
      region = {
        classCode,
        name: ndc?.className ?? '分類なし',
        count: 0,
        divisions: [],
      };
      regions.set(classCode, region);
    }
    region.count++;
    const code = ndc?.divisionCode ?? (ndc ? `${classCode}` : '-');
    const name = ndc?.divisionName ?? (ndc ? ndc.className : '分類なし');
    let division = region.divisions.find((d) => d.code === code);
    if (!division) {
      division = { code, name, items: [] };
      region.divisions.push(division);
    }
    division.items.push(item);
  }
  const list = [...regions.values()];
  for (const r of list)
    r.divisions.sort(
      (a, b) => b.items.length - a.items.length || a.code.localeCompare(b.code),
    );
  return list.sort(
    (a, b) =>
      Number(a.classCode === -1) - Number(b.classCode === -1) ||
      b.count - a.count ||
      a.classCode - b.classCode,
  );
}

// ---- 読み方のタイプ診断 ----

export interface ReadingType {
  axis: 'length' | 'newness' | 'series' | 'author' | 'genre' | 'format';
  /** 当てはまったタイプ（例: 長編派）。当てはまらなければ標準の言い方 */
  label: string;
  /** 見出しに使う短い言葉。標準なら undefined */
  keyword?: string;
  /** 根拠の数値の説明 */
  detail: string;
}

export interface Diagnosis {
  /** 判定に使った読了の冊数 */
  count: number;
  enough: boolean;
  headline: string;
  types: ReadingType[];
}

export const MIN_BOOKS = 5;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function yearsBetween(published: string, finished: string): number | undefined {
  const p = Date.parse(
    published.length === 4
      ? `${published}-07-01`
      : published.length === 7
        ? `${published}-15`
        : published,
  );
  const f = Date.parse(finished);
  if (Number.isNaN(p) || Number.isNaN(f)) return undefined;
  return Math.max(0, (f - p) / (365.25 * 86_400_000));
}

/** 期間内の読了から、読み方の傾向を判定する。 */
export function readingTypes(data: ExportFile, period: Period): Diagnosis {
  const items = finishedIn(data, period);
  const types: ReadingType[] = [];
  if (items.length < MIN_BOOKS)
    return { count: items.length, enough: false, headline: '', types };

  const pages = median(
    items.flatMap((i) => (i.book.pageCount ? [i.book.pageCount] : [])),
  );
  if (pages !== undefined) {
    const p = Math.round(pages);
    types.push(
      p >= 400
        ? {
            axis: 'length',
            label: '長編派',
            keyword: '長編',
            detail: `ページ数の中央値 ${p}ページ`,
          }
        : p <= 220
          ? {
              axis: 'length',
              label: '薄め派',
              keyword: 'サクッと読み',
              detail: `ページ数の中央値 ${p}ページ`,
            }
          : {
              axis: 'length',
              label: '標準的な厚さ',
              detail: `ページ数の中央値 ${p}ページ`,
            },
    );
  }

  const ages = median(
    items.flatMap((i) => {
      const y = i.book.publishedDate
        ? yearsBetween(i.book.publishedDate, i.record.finishedAt)
        : undefined;
      return y === undefined ? [] : [y];
    }),
  );
  if (ages !== undefined) {
    const y = Math.round(ages * 10) / 10;
    types.push(
      ages <= 1
        ? {
            axis: 'newness',
            label: '新刊派',
            keyword: '新刊',
            detail: `出版から読むまで中央値 ${y}年`,
          }
        : ages >= 10
          ? {
              axis: 'newness',
              label: '古典・ロングセラー派',
              keyword: '古典',
              detail: `出版から読むまで中央値 ${y}年`,
            }
          : {
              axis: 'newness',
              label: '新旧バランス型',
              detail: `出版から読むまで中央値 ${y}年`,
            },
    );
  }

  const seriesShare =
    items.filter((i) => parseVolume(i.book.title)).length / items.length;
  types.push(
    seriesShare >= 0.3
      ? {
          axis: 'series',
          label: 'シリーズ派',
          keyword: 'シリーズ',
          detail: `巻数のある本が ${pct(seriesShare)}`,
        }
      : {
          axis: 'series',
          label: '単発派',
          detail: `巻数のある本は ${pct(seriesShare)}`,
        },
  );

  const byAuthor = new Map<string, number>();
  for (const i of items) {
    const a = i.book.authors[0];
    if (a) byAuthor.set(a, (byAuthor.get(a) ?? 0) + 1);
  }
  const repeat =
    items.filter((i) => (byAuthor.get(i.book.authors[0] ?? '') ?? 0) >= 2)
      .length / items.length;
  const top = [...byAuthor.entries()].sort((a, b) => b[1] - a[1])[0];
  const topText =
    top && top[1] >= 2 ? `、いちばん読んだのは${top[0]}（${top[1]}冊）` : '';
  types.push(
    repeat >= 0.4
      ? {
          axis: 'author',
          label: '推し作家派',
          keyword: '推し作家',
          detail: `2冊以上読んだ著者の本が ${pct(repeat)}${topText}`,
        }
      : {
          axis: 'author',
          label: '開拓派',
          keyword: '開拓',
          detail: `2冊以上読んだ著者の本は ${pct(repeat)}${topText}`,
        },
  );

  const classes = new Map<string, number>();
  for (const i of items) {
    const ndc = parseNdc(i.book.ndc);
    if (ndc) classes.set(ndc.className, (classes.get(ndc.className) ?? 0) + 1);
  }
  const classified = [...classes.values()].reduce((a, b) => a + b, 0);
  if (classified >= MIN_BOOKS) {
    const [topClass] = [...classes.entries()].sort((a, b) => b[1] - a[1]);
    const detail = `${classes.size}ジャンル、いちばん多いのは${topClass?.[0] ?? ''}（${topClass?.[1] ?? 0}冊）`;
    types.push(
      classes.size >= 5
        ? { axis: 'genre', label: '雑食派', keyword: '雑食', detail }
        : classes.size <= 2
          ? {
              axis: 'genre',
              label: `${topClass?.[0] ?? ''}一筋`,
              keyword: `${topClass?.[0] ?? ''}一筋`,
              detail,
            }
          : { axis: 'genre', label: 'いくつかのジャンルを往復', detail },
    );
  }

  const audio =
    items.filter((i) => i.record.format === 'audiobook').length / items.length;
  const ebook =
    items.filter((i) => i.record.format === 'ebook').length / items.length;
  types.push(
    audio >= 0.3
      ? {
          axis: 'format',
          label: '耳読書派',
          keyword: '耳読書',
          detail: `オーディオが ${pct(audio)}`,
        }
      : ebook >= 0.5
        ? {
            axis: 'format',
            label: '電子派',
            keyword: '電子',
            detail: `電子書籍が ${pct(ebook)}`,
          }
        : {
            axis: 'format',
            label: '紙中心',
            detail: `紙 ${pct(1 - audio - ebook)}・電子 ${pct(ebook)}・オーディオ ${pct(audio)}`,
          },
  );

  const keywords = types.flatMap((t) => (t.keyword ? [t.keyword] : []));
  const headline =
    keywords.length === 0
      ? 'バランス型の読書家'
      : `${keywords.slice(0, 3).join('・')}タイプ`;
  return { count: items.length, enough: true, headline, types };
}
