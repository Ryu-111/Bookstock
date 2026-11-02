import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReadingRecord } from '../src/domain/book.js';
import {
  applyBookEdit,
  bookToFields,
  changeFormat,
  emptyManualFields,
  parseLogFields,
  parseManualBook,
  parseRecordEdit,
  parseRecordFields,
  recordToFields,
} from '../src/domain/manual.js';
import type { RecordFields } from '../src/domain/manual.js';

await test('parseManualBook: 入力を整えて本の候補にする', () => {
  assert.deepEqual(
    parseManualBook({
      title: ' 合成の本 ',
      authors: '山田太郎、 鈴木花子 / Jane Example',
      publisher: '架空出版',
      publishedDate: '2024.3',
      pageCount: '320',
      isbn: '4-00-310101-4',
    }),
    {
      ok: true,
      value: {
        title: '合成の本',
        authors: ['山田太郎', '鈴木花子', 'Jane Example'],
        source: 'manual',
        publisher: '架空出版',
        publishedDate: '2024-03',
        pageCount: 320,
        isbn13: '9784003101018',
      },
    },
  );
});

await test('parseManualBook: タイトルだけで登録でき、不正な項目はエラー', () => {
  assert.deepEqual(
    parseManualBook({ ...emptyManualFields, title: 'オーディオ版' }),
    {
      ok: true,
      value: { title: 'オーディオ版', authors: [], source: 'manual' },
    },
  );
  const result = parseManualBook({
    ...emptyManualFields,
    pageCount: '0',
    publishedDate: 'そのうち',
    isbn: '1920193006001',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors.length, 4);
    assert.match(result.errors.join('\n'), /タイトル/);
  }
});

const base: RecordFields = {
  format: 'paper',
  status: 'finished',
  platform: '',
  date: '2026-10-31',
  totalMinutes: '',
};

await test('parseRecordFields: 状態に応じて日付を開始日か読了日に入れる', () => {
  assert.deepEqual(parseRecordFields(base), {
    ok: true,
    value: { format: 'paper', status: 'finished', finishedAt: '2026-10-31' },
  });
  assert.deepEqual(parseRecordFields({ ...base, status: 'reading' }), {
    ok: true,
    value: { format: 'paper', status: 'reading', startedAt: '2026-10-31' },
  });
  assert.deepEqual(
    parseRecordFields({ ...base, status: 'stacked', date: '' }),
    {
      ok: true,
      value: { format: 'paper', status: 'stacked' },
    },
  );
});

await test('parseRecordFields: オーディオはサービスと長さを持ち、紙ではサービスを捨てる', () => {
  assert.deepEqual(
    parseRecordFields({
      ...base,
      format: 'audiobook',
      platform: ' Audible ',
      totalMinutes: '615',
    }),
    {
      ok: true,
      value: {
        format: 'audiobook',
        status: 'finished',
        finishedAt: '2026-10-31',
        platform: 'Audible',
        totalMinutes: 615,
      },
    },
  );
  assert.deepEqual(
    parseRecordFields({ ...base, platform: 'Kindle', totalMinutes: '9' }),
    {
      ok: true,
      value: { format: 'paper', status: 'finished', finishedAt: '2026-10-31' },
    },
  );
});

await test('parseRecordFields: 不正な形式・日付・長さはエラー', () => {
  assert.equal(parseRecordFields({ ...base, format: 'vinyl' }).ok, false);
  assert.equal(parseRecordFields({ ...base, status: 'done' }).ok, false);
  assert.equal(parseRecordFields({ ...base, date: '' }).ok, false);
  assert.equal(parseRecordFields({ ...base, date: '2026/10/31' }).ok, false);
  assert.equal(
    parseRecordFields({ ...base, format: 'audiobook', totalMinutes: '1.5' }).ok,
    false,
  );
});

const current: ReadingRecord = {
  id: 'r',
  bookId: 'b',
  format: 'audiobook',
  status: 'reading',
  platform: 'Audible',
  totalMinutes: 600,
  tags: ['小説'],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

await test('parseRecordEdit: 記録の値をフォームにして、そのまま戻せる', () => {
  assert.deepEqual(parseRecordEdit(recordToFields(current), current), {
    ok: true,
    value: current,
  });
});

await test('parseRecordEdit: 評価・メモ・日付・タグを当て、紙ではサービスと長さを捨てる', () => {
  const result = parseRecordEdit(
    {
      ...recordToFields(current),
      format: 'paper',
      status: 'finished',
      startedAt: '2026-10-01',
      finishedAt: '2026-10-20',
      rating: '4',
      memo: ' よかった ',
      tags: '小説、 再読, 小説',
    },
    current,
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      id: 'r',
      bookId: 'b',
      format: 'paper',
      status: 'finished',
      startedAt: '2026-10-01',
      finishedAt: '2026-10-20',
      rating: 4,
      memo: 'よかった',
      tags: ['小説', '再読'],
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    },
  });
});

await test('parseRecordEdit: 開始日 > 読了日、評価0、不正な日付はエラー', () => {
  const fields = recordToFields(current);
  const errors = (patch: Partial<typeof fields>) => {
    const r = parseRecordEdit({ ...fields, ...patch }, current);
    return r.ok ? [] : r.errors;
  };
  assert.match(
    errors({ startedAt: '2026-10-20', finishedAt: '2026-10-01' }).join(),
    /開始日は読了日より前/,
  );
  assert.match(errors({ rating: '0' }).join(), /評価/);
  assert.match(errors({ finishedAt: '2026/10/01' }).join(), /読了日/);
  assert.match(errors({ totalMinutes: 'abc' }).join(), /長さ/);
});

await test('parseLogFields: オーディオは分、それ以外はページ', () => {
  assert.deepEqual(
    parseLogFields({ date: '2026-10-31', amount: '45' }, 'audiobook'),
    {
      ok: true,
      value: { date: '2026-10-31', minutes: 45 },
    },
  );
  assert.deepEqual(
    parseLogFields({ date: '2026-10-31', amount: '20' }, 'ebook'),
    {
      ok: true,
      value: { date: '2026-10-31', pages: 20 },
    },
  );
  const bad = parseLogFields({ date: '', amount: '0' }, 'paper');
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.errors.length, 2);
});

await test('applyBookEdit: idと書影・分類を引き継ぎ、sourceは手入力になる', () => {
  const book = {
    id: 'b',
    title: '旧タイトル',
    authors: ['山田太郎'],
    coverUrl: 'https://example.test/c.jpg',
    ndc: '913.6',
    source: 'openbd' as const,
  };
  assert.deepEqual(
    applyBookEdit(book, { ...bookToFields(book), title: '新タイトル' }),
    {
      ok: true,
      value: {
        id: 'b',
        title: '新タイトル',
        authors: ['山田太郎'],
        source: 'manual',
        coverUrl: 'https://example.test/c.jpg',
        ndc: '913.6',
      },
    },
  );
  assert.equal(
    applyBookEdit(book, { ...bookToFields(book), title: '' }).ok,
    false,
  );
});

await test('changeFormat: 紙はサービスと長さを外し、オーディオ以外は長さを外す', () => {
  const audio: ReadingRecord = { ...current };
  assert.deepEqual(changeFormat(audio, 'paper'), {
    id: 'r',
    bookId: 'b',
    format: 'paper',
    status: 'reading',
    tags: ['小説'],
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });
  const ebook = changeFormat(audio, 'ebook', 'Kindle');
  assert.equal(ebook.platform, 'Kindle');
  assert.equal(ebook.totalMinutes, undefined);
  assert.equal(changeFormat(audio, 'ebook').platform, 'Audible'); // 空なら今の値を残す
  const paper: ReadingRecord = {
    id: 'r',
    bookId: 'b',
    format: 'paper',
    status: 'reading',
    tags: [],
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  };
  assert.deepEqual(changeFormat(paper, 'audiobook', ' Audible '), {
    ...paper,
    format: 'audiobook',
    platform: 'Audible',
  });
  assert.equal(changeFormat(audio, 'audiobook').totalMinutes, 600);
});

await test('changeFormat: オーディオにするとき、長さが空なら指定の値を入れ、あれば変えない', () => {
  const paper: ReadingRecord = {
    id: 'p',
    bookId: 'b',
    format: 'paper',
    status: 'finished',
    tags: [],
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  };
  assert.equal(
    changeFormat(paper, 'audiobook', undefined, 510).totalMinutes,
    510,
  );
  assert.equal(
    changeFormat(current, 'audiobook', undefined, 510).totalMinutes,
    600,
  );
  assert.equal(
    changeFormat(paper, 'ebook', undefined, 510).totalMinutes,
    undefined,
  );
});
