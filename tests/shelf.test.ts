import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExportFile, ReadingRecord } from '../src/domain/book.js';
import { allTags, filterRecords } from '../src/domain/shelf.js';

const record = (
  id: string,
  bookId: string,
  patch: Partial<ReadingRecord>,
): ReadingRecord => ({
  id,
  bookId,
  format: 'paper',
  status: 'reading',
  tags: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...patch,
});

const data: ExportFile = {
  schemaVersion: 1,
  exportedAt: '2026-10-31T00:00:00Z',
  books: [
    {
      id: 'a',
      title: 'ＴｙｐｅＳｃｒｉｐｔ入門',
      authors: ['山田太郎'],
      source: 'manual',
    },
    { id: 'b', title: '合成の小説', authors: ['鈴木花子'], source: 'manual' },
  ],
  records: [
    record('r1', 'a', {
      tags: ['技術', '仕事'],
      updatedAt: '2026-10-03T00:00:00Z',
    }),
    record('r2', 'b', {
      format: 'audiobook',
      status: 'finished',
      tags: ['小説'],
      updatedAt: '2026-10-05T00:00:00Z',
    }),
    record('r3', 'b', {
      format: 'paper',
      status: 'stacked',
      tags: ['小説'],
      updatedAt: '2026-10-04T00:00:00Z',
    }),
    record('orphan', 'missing', {}),
  ],
  logs: [],
};

const ids = (filter: Parameters<typeof filterRecords>[1]) =>
  filterRecords(data, filter).map((i) => i.record.id);

await test('絞り込みなしでは更新日の新しい順。本のない記録は出さない', () => {
  assert.deepEqual(ids({}), ['r2', 'r3', 'r1']);
});

await test('形式・状態・タグ・キーワードで絞り込む', () => {
  assert.deepEqual(ids({ format: 'audiobook' }), ['r2']);
  assert.deepEqual(ids({ status: 'stacked' }), ['r3']);
  assert.deepEqual(ids({ tag: '小説' }), ['r2', 'r3']);
  assert.deepEqual(ids({ text: 'typescript' }), ['r1']);
  assert.deepEqual(ids({ text: '鈴木 小説' }), ['r2', 'r3']);
  assert.deepEqual(ids({ tag: '小説', format: 'paper' }), ['r3']);
  assert.deepEqual(ids({ text: '存在しない' }), []);
});

await test('読み仮名でも検索でき、タイトル順は読み仮名で並べる', () => {
  const kana: ExportFile = {
    ...data,
    books: [
      { ...data.books[0]!, titleKana: 'タイプスクリプトニュウモン' },
      { ...data.books[1]!, titleKana: 'ゴウセイノショウセツ' },
    ],
  };
  assert.deepEqual(
    filterRecords(kana, { text: 'ごうせい' }).map((i) => i.record.id),
    ['r2', 'r3'],
  );
  assert.deepEqual(
    filterRecords(kana, { text: 'ゴウセイ' }).map((i) => i.record.id),
    ['r2', 'r3'],
  );
  assert.deepEqual(
    filterRecords(kana, { sort: 'title' }).map((i) => i.record.id),
    ['r2', 'r3', 'r1'],
  );
});

await test('タグはよく使う順（同数はロケール順）', () => {
  const tags = allTags(data);
  assert.equal(tags[0], '小説');
  assert.deepEqual([...tags].sort(), ['仕事', '小説', '技術'].sort());
});
