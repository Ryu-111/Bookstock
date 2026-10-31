import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type { BookCandidate, ExportFile } from '../src/domain/book.js';
import { Repository, openDb } from '../src/storage/db.js';
import { parseExportFile } from '../src/storage/export-file.js';

function clock() {
  let n = 0;
  return {
    now: () => new Date('2026-10-31T09:00:00.000Z'),
    id: () => `id-${++n}`,
  };
}

async function repo() {
  return new Repository(await openDb(new IDBFactory()), clock());
}

const candidate: BookCandidate = {
  title: 'テスト用の本',
  authors: ['山田太郎'],
  isbn13: '9784000000000',
  pageCount: 320,
  source: 'openbd',
};

await test('同じISBNの本は再利用し、形式の違う記録を2件持てる', async () => {
  const r = await repo();
  const paper = await r.addRecord(candidate, {
    format: 'paper',
    status: 'finished',
    finishedAt: '2026-10-01',
  });
  const audio = await r.addRecord(
    { ...candidate, source: 'google' },
    { format: 'audiobook', status: 'reading', platform: 'Audible' },
  );
  assert.equal(audio.book.id, paper.book.id);
  const data = await r.snapshot();
  assert.equal(data.books.length, 1);
  assert.deepEqual(
    data.records.map((x) => [x.format, x.status]),
    [
      ['paper', 'finished'],
      ['audiobook', 'reading'],
    ],
  );
});

await test('ISBNのない本は毎回別の本として保存する', async () => {
  const r = await repo();
  const noIsbn: BookCandidate = {
    title: candidate.title,
    authors: candidate.authors,
    source: 'manual',
  };
  await r.addRecord(noIsbn, { format: 'ebook', status: 'want' });
  await r.addRecord(noIsbn, { format: 'ebook', status: 'want' });
  assert.equal((await r.snapshot()).books.length, 2);
});

await test('記録を消すと進捗ログと、参照のなくなった本も消える', async () => {
  const r = await repo();
  const a = await r.addRecord(candidate, {
    format: 'paper',
    status: 'reading',
  });
  const b = await r.addRecord(candidate, {
    format: 'ebook',
    status: 'reading',
  });
  const data = await r.snapshot();
  await r.importFile(
    {
      ...data,
      logs: [
        { id: 'log-1', recordId: a.record.id, date: '2026-10-30', pages: 20 },
      ],
    },
    'replace',
  );
  await r.deleteRecord(a.record.id);
  let after = await r.snapshot();
  assert.equal(after.books.length, 1);
  assert.deepEqual(after.logs, []);
  await r.deleteRecord(b.record.id);
  after = await r.snapshot();
  assert.deepEqual([after.books, after.records], [[], []]);
  await r.deleteRecord('missing');
});

await test('エクスポート→別のDBへインポートで一致する（往復）', async () => {
  const source = await repo();
  await source.addRecord(candidate, {
    format: 'paper',
    status: 'finished',
    finishedAt: '2026-10-01',
  });
  await source.addRecord(
    { title: 'オーディオ版', authors: [], source: 'manual' },
    { format: 'audiobook', status: 'want', platform: 'Audible' },
  );
  const exported = await source.snapshot();
  const parsed = parseExportFile(JSON.stringify(exported));
  assert.ok(parsed.ok);
  const target = await repo();
  await target.importFile(parsed.value, 'replace');
  assert.deepEqual(await target.snapshot(), exported);
});

await test('mergeは同じidを上書きし、既存の記録を残す', async () => {
  const r = await repo();
  const existing = await r.addRecord(candidate, {
    format: 'paper',
    status: 'reading',
  });
  const before = await r.snapshot();
  const incoming: ExportFile = {
    ...before,
    records: [
      { ...existing.record, status: 'finished', finishedAt: '2026-10-31' },
    ],
    books: [
      ...before.books,
      { id: 'other', title: '別の本', authors: [], source: 'manual' },
    ],
  };
  await r.importFile(incoming, 'merge');
  const after = await r.snapshot();
  assert.equal(after.books.length, 2);
  assert.equal(after.records[0]?.status, 'finished');
});

await test('不正なファイルはインポートせず、既存データを残す', async () => {
  const r = await repo();
  await r.addRecord(candidate, { format: 'paper', status: 'reading' });
  const before = await r.snapshot();
  const broken = {
    ...before,
    records: [{ ...before.records[0], bookId: 'missing' }],
  } as unknown as ExportFile;
  await assert.rejects(r.importFile(broken, 'replace'), /bookId missing/);
  assert.deepEqual(await r.snapshot(), before);
});

await test('parseExportFile: JSON不正・新しいバージョン・型違いを拒否する', () => {
  const base = {
    schemaVersion: 1,
    exportedAt: '2026-10-31T00:00:00Z',
    books: [],
    records: [],
    logs: [],
  };
  assert.ok(parseExportFile(JSON.stringify(base)).ok);
  const cases: [unknown, RegExp][] = [
    ['{', /JSON/],
    [{ ...base, schemaVersion: 2 }, /新しいバージョン/],
    [{ ...base, schemaVersion: undefined }, /schemaVersion/],
    [{ ...base, books: {} }, /books: 配列/],
    [
      { ...base, books: [{ id: 'b', title: 'x', authors: [], source: 'web' }] },
      /source/,
    ],
    [
      {
        ...base,
        books: [
          {
            id: 'b',
            title: 'x',
            authors: [],
            source: 'manual',
            isbn13: '9784000000001',
          },
        ],
      },
      /isbn13/,
    ],
    [
      {
        ...base,
        books: [
          {
            id: 'b',
            title: 'x',
            authors: [],
            source: 'manual',
            coverUrl: 'javascript:alert(1)',
          },
        ],
      },
      /coverUrl/,
    ],
    [
      {
        ...base,
        books: [{ id: 'b', title: 'x', authors: [], source: 'manual' }],
        records: [
          {
            id: 'r',
            bookId: 'b',
            format: 'paper',
            status: 'reading',
            rating: 6,
            tags: [],
            createdAt: 'x',
            updatedAt: '2026-10-31T00:00:00Z',
          },
        ],
      },
      /rating.*createdAt|createdAt|rating/,
    ],
    [
      {
        ...base,
        books: [
          { id: 'b', title: 'x', authors: [], source: 'manual' },
          { id: 'b', title: 'y', authors: [], source: 'manual' },
        ],
      },
      /重複/,
    ],
  ];
  for (const [input, pattern] of cases) {
    const result = parseExportFile(
      typeof input === 'string' ? input : JSON.stringify(input),
    );
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.match(result.errors.join('\n'), pattern);
  }
});

await test('IndexedDBの中身が壊れていたら読み出しで止める', async () => {
  const db = await openDb(new IDBFactory());
  const tx = db.transaction('records', 'readwrite');
  tx.objectStore('records').put({ id: 'r', bookId: 'none', format: 'vinyl' });
  await new Promise((resolve) => (tx.oncomplete = resolve));
  await assert.rejects(
    new Repository(db, clock()).snapshot(),
    /保存データが壊れています/,
  );
});

await test('updateRecord: 状態・評価を変え、updatedAtを進め、作成日時と本は変えない', async () => {
  const r = new Repository(await openDb(new IDBFactory()), {
    ...clock(),
    now: (() => {
      let t = 0;
      return () => new Date(Date.UTC(2026, 9, 31, 9, 0, t++));
    })(),
  });
  const { record } = await r.addRecord(candidate, {
    format: 'paper',
    status: 'reading',
  });
  const updated = await r.updateRecord({
    ...record,
    status: 'finished',
    finishedAt: '2026-10-31',
    rating: 5,
    createdAt: '2000-01-01T00:00:00Z',
  });
  assert.equal(updated.createdAt, record.createdAt);
  assert.ok(updated.updatedAt > record.updatedAt);
  assert.deepEqual((await r.snapshot()).records, [updated]);
  await assert.rejects(
    r.updateRecord({ ...record, bookId: 'other' }),
    /本は変更できません/,
  );
  await assert.rejects(
    r.updateRecord({ ...record, id: 'missing' }),
    /見つかりません/,
  );
  await assert.rejects(
    r.updateRecord({ ...record, rating: 9 as 5 }),
    /入力が正しくありません/,
  );
  assert.deepEqual((await r.snapshot()).records, [updated]);
});

await test('updateBook / addRecordForBook: ISBNのない本に別形式の記録を足せる', async () => {
  const r = await repo();
  const manual: BookCandidate = {
    title: '手入力の本',
    authors: [],
    source: 'manual',
  };
  const { book } = await r.addRecord(manual, {
    format: 'ebook',
    status: 'reading',
  });
  await r.updateBook({ ...book, title: '直したタイトル' });
  const audio = await r.addRecordForBook(book.id, {
    format: 'audiobook',
    status: 'want',
  });
  const data = await r.snapshot();
  assert.deepEqual(
    data.books.map((b) => b.title),
    ['直したタイトル'],
  );
  assert.equal(data.records.length, 2);
  assert.equal(audio.bookId, book.id);
  await assert.rejects(
    r.updateBook({ ...book, title: '' }),
    /入力が正しくありません/,
  );
  await assert.rejects(
    r.updateBook({ ...book, id: 'missing' }),
    /見つかりません/,
  );
  await assert.rejects(
    r.addRecordForBook('missing', { format: 'paper', status: 'want' }),
    /見つかりません/,
  );
});

await test('addLog / deleteLog: 進捗を足して消せる。存在しない記録・不正値は書かない', async () => {
  const r = await repo();
  const { record } = await r.addRecord(candidate, {
    format: 'paper',
    status: 'reading',
  });
  const log = await r.addLog(record.id, { date: '2026-10-30', pages: 30 });
  assert.deepEqual((await r.snapshot()).logs, [log]);
  await assert.rejects(
    r.addLog('missing', { date: '2026-10-30', pages: 1 }),
    /見つかりません/,
  );
  await assert.rejects(
    r.addLog(record.id, { date: '30日', pages: 1 }),
    /入力が正しくありません/,
  );
  await r.deleteLog(log.id);
  assert.deepEqual((await r.snapshot()).logs, []);
});
