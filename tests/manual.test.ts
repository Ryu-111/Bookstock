import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyManualFields,
  parseManualBook,
  parseRecordFields,
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
