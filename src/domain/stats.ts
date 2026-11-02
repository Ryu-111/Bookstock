import { estimateMinutes } from './audio.js';
import { STATUSES } from './book.js';
import type {
  Book,
  ExportFile,
  Format,
  ReadingRecord,
  Status,
} from './book.js';

/** 集計する期間。年、または全期間。 */
export type Period = { kind: 'year'; year: number } | { kind: 'all' };

export interface Amount {
  count: number;
  pages: number;
  minutes: number;
}

export interface Bucket {
  /** YYYY-MM（月）または YYYY（年） */
  key: string;
  label: string;
  byFormat: Record<Format, Amount>;
  total: Amount;
}

export interface DayActivity {
  date: string;
  pages: number;
  minutes: number;
  finished: number;
}

export const NDC_LABELS = [
  '総記',
  '哲学',
  '歴史',
  '社会科学',
  '自然科学',
  '技術',
  '産業',
  '芸術',
  '言語',
  '文学',
] as const;

export interface Stats {
  /** 期間内に読了した記録（読了日のあるもの） */
  finished: Amount & { uniqueBooks: number; byFormat: Record<Format, Amount> };
  /** 紙・電子の読了でページ数のない本の数 */
  pagesMissing: number;
  /** オーディオの読了で、長さも進捗の分もない記録の数 */
  minutesMissing: number;
  /** 長さ・進捗の分・ページ数のどれもないオーディオの読了記録のid */
  minutesMissingIds: string[];
  /** ページ数から長さを推定して数えた記録の数・分・id */
  minutesEstimated: number;
  estimatedMinutes: number;
  minutesEstimatedIds: string[];
  /** 読了なのに読了日がない記録の数（期間に関係なく、集計から除く） */
  undated: number;
  /** 割り算に使った日数・月数（今年なら今日まで） */
  days: number;
  months: number;
  pagesPerDay: number;
  booksPerMonth: number;
  granularity: 'month' | 'year';
  buckets: Bucket[];
  /** 冊数が最多の区間 */
  best: Bucket | null;
  /** 期間内の日ごとの活動（進捗ログと読了） */
  calendar: DayActivity[];
  calendarRange: { from: string; to: string };
  /** 現在の状態の内訳（期間に関係ない） */
  statuses: Record<Status, number>;
  /** 期間内の読了の評価。index 0 は評価なし */
  ratings: [number, number, number, number, number, number];
  /** 期間内の読了の本のNDC大分類。分類のない本は unclassified */
  ndc: { code: number; label: string; count: number }[];
  unclassified: number;
  /** 記録のある年（新しい順） */
  years: number[];
}

const DAY_MS = 86_400_000;

function zero(): Amount {
  return { count: 0, pages: 0, minutes: 0 };
}

function byFormat(): Record<Format, Amount> {
  return { paper: zero(), ebook: zero(), audiobook: zero() };
}

function add(target: Amount, value: Amount) {
  target.count += value.count;
  target.pages += value.pages;
  target.minutes += value.minutes;
}

/** YYYY-MM-DD をUTCの日付として数える（タイムゾーンに左右されない）。 */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function dateOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function monthKey(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function inPeriod(date: string, period: Period): boolean {
  return period.kind === 'all' || date.startsWith(`${period.year}-`);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 記録1件の量。ページは紙・電子で本にページ数があるとき、分はオーディオで長さがあるとき。 */
/** オーディオの分の出どころ。 */
type MinutesSource = 'length' | 'logs' | 'estimate' | 'none';

/**
 * オーディオの分を、長さ（totalMinutes）→ 進捗ログの分 → ページ数からの推定 の順で決める。
 */
function audioMinutes(
  record: ReadingRecord,
  book: Book | undefined,
  loggedMinutes: number,
): { minutes: number; source: MinutesSource } {
  if (record.totalMinutes)
    return { minutes: record.totalMinutes, source: 'length' };
  if (loggedMinutes > 0) return { minutes: loggedMinutes, source: 'logs' };
  const estimated = estimateMinutes(book?.pageCount);
  if (estimated) return { minutes: estimated, source: 'estimate' };
  return { minutes: 0, source: 'none' };
}

/**
 * 統計を集計する。読了は読了日（finishedAt）で数え、登録日では代用しない。
 * today はローカルの今日（YYYY-MM-DD）。
 */
export function computeStats(
  data: ExportFile,
  period: Period,
  today: string,
): Stats {
  const books = new Map(data.books.map((b) => [b.id, b]));
  const loggedMinutes = new Map<string, number>();
  for (const log of data.logs)
    if (log.minutes)
      loggedMinutes.set(
        log.recordId,
        (loggedMinutes.get(log.recordId) ?? 0) + log.minutes,
      );
  const finishedRecords = data.records.filter((r) => r.status === 'finished');
  const dated = finishedRecords.filter(
    (r): r is ReadingRecord & { finishedAt: string } => !!r.finishedAt,
  );
  const undated = finishedRecords.length - dated.length;
  const inRange = dated.filter((r) => inPeriod(r.finishedAt, period));
  const todayDay = dayNumber(today);

  // 期間の始まりと終わり（割り算・カレンダー用）
  let fromDay: number;
  let toDay: number;
  if (period.kind === 'year') {
    fromDay = dayNumber(`${period.year}-01-01`);
    toDay = Math.min(dayNumber(`${period.year}-12-31`), todayDay);
  } else {
    const starts = [
      ...dated.map((r) => r.finishedAt),
      ...data.logs.map((l) => l.date),
    ].map(dayNumber);
    fromDay = starts.length > 0 ? Math.min(...starts) : todayDay;
    toDay = todayDay;
  }
  const days = Math.max(0, toDay - fromDay + 1);

  const finished = { ...zero(), uniqueBooks: 0, byFormat: byFormat() };
  let pagesMissing = 0;
  let minutesMissing = 0;
  const minutesMissingIds: string[] = [];
  let minutesEstimated = 0;
  let estimatedMinutes = 0;
  const minutesEstimatedIds: string[] = [];
  const ratings: Stats['ratings'] = [0, 0, 0, 0, 0, 0];
  const ndcCounts = new Map<number, number>();
  let unclassified = 0;
  const uniqueBooks = new Set<string>();

  // 区間（月、全期間で24か月を超えるなら年）
  const fromMonth = monthIndex(dateOf(fromDay));
  const toMonth = monthIndex(dateOf(Math.max(fromDay, toDay)));
  const granularity: Stats['granularity'] =
    period.kind === 'all' && toMonth - fromMonth + 1 > 24 ? 'year' : 'month';
  const buckets: Bucket[] = [];
  const bucketOf = new Map<string, Bucket>();
  const makeBucket = (key: string, label: string) => {
    const bucket = { key, label, byFormat: byFormat(), total: zero() };
    buckets.push(bucket);
    bucketOf.set(key, bucket);
  };
  if (period.kind === 'year') {
    for (let m = 0; m < 12; m++)
      makeBucket(
        `${period.year}-${String(m + 1).padStart(2, '0')}`,
        `${m + 1}月`,
      );
  } else if (granularity === 'month') {
    for (let i = fromMonth; i <= toMonth; i++) {
      const key = monthKey(i);
      makeBucket(key, `${key.slice(0, 4)}/${Number(key.slice(5))}`);
    }
  } else {
    for (let y = Math.floor(fromMonth / 12); y <= Math.floor(toMonth / 12); y++)
      makeBucket(String(y), `${y}`);
  }

  for (const record of inRange) {
    const book = books.get(record.bookId);
    const audio =
      record.format === 'audiobook'
        ? audioMinutes(record, book, loggedMinutes.get(record.id) ?? 0)
        : undefined;
    const amount: Amount = audio
      ? { count: 1, pages: 0, minutes: audio.minutes }
      : { count: 1, pages: book?.pageCount ?? 0, minutes: 0 };
    add(finished, amount);
    add(finished.byFormat[record.format], amount);
    uniqueBooks.add(record.bookId);
    if (audio) {
      if (audio.source === 'none') {
        minutesMissing++;
        minutesMissingIds.push(record.id);
      } else if (audio.source === 'estimate') {
        minutesEstimated++;
        estimatedMinutes += audio.minutes;
        minutesEstimatedIds.push(record.id);
      }
    } else if (!book?.pageCount) pagesMissing++;
    ratings[record.rating ?? 0]++;
    const code = book?.ndc ? Number(book.ndc.trim()[0]) : NaN;
    if (Number.isInteger(code))
      ndcCounts.set(code, (ndcCounts.get(code) ?? 0) + 1);
    else unclassified++;
    const key =
      granularity === 'year'
        ? record.finishedAt.slice(0, 4)
        : record.finishedAt.slice(0, 7);
    const bucket = bucketOf.get(key);
    if (bucket) {
      add(bucket.total, amount);
      add(bucket.byFormat[record.format], amount);
    }
  }
  finished.uniqueBooks = uniqueBooks.size;

  // カレンダー: 年ならその年の1/1〜12/31、全期間なら直近1年
  const calFrom =
    period.kind === 'year' ? dayNumber(`${period.year}-01-01`) : todayDay - 364;
  const calTo =
    period.kind === 'year' ? dayNumber(`${period.year}-12-31`) : todayDay;
  const activity = new Map<string, DayActivity>();
  const touch = (date: string) => {
    let day = activity.get(date);
    if (!day) {
      day = { date, pages: 0, minutes: 0, finished: 0 };
      activity.set(date, day);
    }
    return day;
  };
  const inCalendar = (date: string) => {
    const d = dayNumber(date);
    return d >= calFrom && d <= calTo;
  };
  for (const log of data.logs) {
    if (!inCalendar(log.date)) continue;
    const day = touch(log.date);
    day.pages += log.pages ?? 0;
    day.minutes += log.minutes ?? 0;
  }
  for (const record of dated)
    if (inCalendar(record.finishedAt)) touch(record.finishedAt).finished++;

  const statuses = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    Status,
    number
  >;
  for (const r of data.records) statuses[r.status]++;

  const months =
    period.kind === 'year'
      ? Math.max(0, Math.min(12, toMonth - fromMonth + 1))
      : Math.max(1, toMonth - fromMonth + 1);
  const best = buckets.reduce<Bucket | null>(
    (top, b) => (b.total.count > (top?.total.count ?? 0) ? b : top),
    null,
  );
  const years = [
    ...new Set([
      ...dated.map((r) => Number(r.finishedAt.slice(0, 4))),
      Number(today.slice(0, 4)),
    ]),
  ].sort((a, b) => b - a);

  return {
    finished,
    pagesMissing,
    minutesMissing,
    minutesMissingIds,
    minutesEstimated,
    estimatedMinutes,
    minutesEstimatedIds,
    undated,
    days,
    months,
    pagesPerDay: days > 0 ? round1(finished.pages / days) : 0,
    booksPerMonth: months > 0 ? round1(finished.count / months) : 0,
    granularity,
    buckets,
    best,
    calendar: [...activity.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    calendarRange: { from: dateOf(calFrom), to: dateOf(calTo) },
    statuses,
    ratings,
    ndc: [...ndcCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([code, count]) => ({
        code,
        label: NDC_LABELS[code] ?? String(code),
        count,
      })),
    unclassified,
    years,
  };
}
