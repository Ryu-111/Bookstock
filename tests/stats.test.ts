import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExportFile, ReadingRecord } from '../src/domain/book.js';
import { computeStats } from '../src/domain/stats.js';

let n = 0;
const rec = (bookId: string, patch: Partial<ReadingRecord>): ReadingRecord => ({
  id: `r${++n}`,
  bookId,
  format: 'paper',
  status: 'finished',
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...patch,
});

const data: ExportFile = {
  schemaVersion: 1,
  exportedAt: '2026-10-31T00:00:00Z',
  books: [
    {
      id: 'a',
      title: 'A',
      authors: [],
      source: 'manual',
      pageCount: 300,
      ndc: '913.6',
    },
    {
      id: 'b',
      title: 'B',
      authors: [],
      source: 'manual',
      pageCount: 200,
      ndc: '007',
    },
    { id: 'c', title: 'C', authors: [], source: 'manual' },
  ],
  records: [
    rec('a', { finishedAt: '2025-12-31', rating: 5 }),
    rec('a', {
      finishedAt: '2026-01-01',
      format: 'audiobook',
      totalMinutes: 600,
      rating: 4,
    }),
    rec('b', { finishedAt: '2026-03-10', format: 'ebook' }),
    rec('c', { finishedAt: '2026-03-20' }), // ページ数なし・分類なし
    rec('b', {}), // 読了日なし
    rec('c', { status: 'reading' }),
    rec('c', { status: 'stacked' }),
    rec('a', { format: 'audiobook', finishedAt: '2026-04-01' }), // 長さなし
  ],
  logs: [
    { id: 'l1', recordId: 'r6', date: '2026-10-30', pages: 40 },
    { id: 'l2', recordId: 'r6', date: '2026-10-30', pages: 10 },
    { id: 'l3', recordId: 'r2', date: '2025-06-01', minutes: 30 },
  ],
};

await test('年の境界: 12/31は前年、1/1は今年。読了日のない記録は除いて数える', () => {
  const s = computeStats(data, { kind: 'year', year: 2026 }, '2026-10-31');
  assert.equal(s.finished.count, 4);
  assert.equal(s.finished.uniqueBooks, 3);
  assert.equal(s.finished.byFormat.audiobook.count, 2);
  assert.equal(s.finished.pages, 200);
  assert.equal(s.finished.minutes, 600 + 510); // 長さのない1件は300ページ×1.7分で推定
  assert.equal(s.pagesMissing, 1);
  assert.equal(s.minutesMissing, 0);
  assert.equal(s.minutesEstimated, 1);
  assert.equal(s.estimatedMinutes, 510);
  assert.equal(s.undated, 1);
  const prev = computeStats(data, { kind: 'year', year: 2025 }, '2026-10-31');
  assert.equal(prev.finished.count, 1);
  assert.equal(prev.finished.pages, 300);
  assert.equal(prev.days, 365);
});

await test('今年の1日あたりのページと月平均は今日までで割る', () => {
  const s = computeStats(data, { kind: 'year', year: 2026 }, '2026-10-31');
  assert.equal(s.days, 304); // 1/1〜10/31
  assert.equal(s.months, 10);
  assert.equal(s.pagesPerDay, Math.round((200 / 304) * 10) / 10);
  assert.equal(s.booksPerMonth, 0.4);
});

await test('月別: 12か月の区間に形式別に入れ、最多の月を返す', () => {
  const s = computeStats(data, { kind: 'year', year: 2026 }, '2026-10-31');
  assert.equal(s.buckets.length, 12);
  const march = s.buckets[2]!;
  assert.equal(march.label, '3月');
  assert.equal(march.total.count, 2);
  assert.equal(march.byFormat.ebook.pages, 200);
  assert.equal(s.best?.key, '2026-03');
});

await test('評価・NDC・状態の内訳', () => {
  const s = computeStats(data, { kind: 'year', year: 2026 }, '2026-10-31');
  assert.deepEqual(s.ratings, [3, 0, 0, 0, 1, 0]);
  assert.deepEqual(
    s.ndc.map((x) => [x.label, x.count]),
    [
      ['文学', 2],
      ['総記', 1],
    ],
  );
  assert.equal(s.unclassified, 1);
  assert.equal(s.statuses.finished, 6);
  assert.equal(s.statuses.reading, 1);
  assert.equal(s.statuses.stacked, 1);
});

await test('カレンダー: 進捗ログを日ごとに合計し、読了日も数える', () => {
  const s = computeStats(data, { kind: 'year', year: 2026 }, '2026-10-31');
  assert.deepEqual(
    s.calendar.find((d) => d.date === '2026-10-30'),
    { date: '2026-10-30', pages: 50, minutes: 0, finished: 0 },
  );
  assert.equal(s.calendar.find((d) => d.date === '2026-03-10')?.finished, 1);
  assert.equal(
    s.calendar.some((d) => d.date.startsWith('2025')),
    false,
  );
  assert.deepEqual(s.calendarRange, { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(s.years, [2026, 2025]);
});

await test('全期間: 最初の記録から今日まで。24か月を超えたら年ごとにする', () => {
  const s = computeStats(data, { kind: 'all' }, '2026-10-31');
  assert.equal(s.finished.count, 5);
  assert.equal(s.granularity, 'month');
  assert.equal(s.buckets[0]?.key, '2025-06'); // 最初の進捗ログ
  const long = computeStats(data, { kind: 'all' }, '2028-01-15');
  assert.equal(long.granularity, 'year');
  assert.deepEqual(
    long.buckets.map((b) => b.key),
    ['2025', '2026', '2027', '2028'],
  );
});

await test('空のデータでも0を返す', () => {
  const empty: ExportFile = { ...data, books: [], records: [], logs: [] };
  const s = computeStats(empty, { kind: 'all' }, '2026-10-31');
  assert.equal(s.finished.count, 0);
  assert.equal(s.pagesPerDay, 0);
  assert.equal(s.best, null);
  assert.equal(s.days, 1);
  const future = computeStats(
    empty,
    { kind: 'year', year: 2030 },
    '2026-10-31',
  );
  assert.equal(future.days, 0);
  assert.equal(future.pagesPerDay, 0);
});

await test('聴いた時間: 長さ → 進捗の分 → ページ数からの推定の順に使う', () => {
  const d: ExportFile = {
    ...data,
    records: [
      rec('a', { id: 'x1', format: 'audiobook', finishedAt: '2026-05-01' }),
      rec('a', {
        id: 'x2',
        format: 'audiobook',
        finishedAt: '2026-05-02',
        totalMinutes: 300,
      }),
      rec('a', { id: 'x3', format: 'audiobook', finishedAt: '2026-05-03' }),
      rec('c', { id: 'x4', format: 'audiobook', finishedAt: '2026-05-04' }),
    ],
    logs: [
      { id: 'm1', recordId: 'x1', date: '2026-04-30', minutes: 40 },
      { id: 'm2', recordId: 'x1', date: '2026-05-01', minutes: 20 },
      { id: 'm3', recordId: 'x2', date: '2026-05-01', minutes: 999 },
    ],
  };
  const s = computeStats(d, { kind: 'year', year: 2026 }, '2026-10-31');
  // x1は進捗の分、x2は長さ（進捗より優先）、x3はページ数から推定、x4はページ数もなく0
  assert.equal(s.finished.minutes, 60 + 300 + 510);
  assert.equal(s.buckets[4]?.total.minutes, 870);
  assert.equal(s.minutesEstimated, 1);
  assert.deepEqual(s.minutesEstimatedIds, ['x3']);
  assert.equal(s.minutesMissing, 1);
  assert.deepEqual(s.minutesMissingIds, ['x4']);
});
