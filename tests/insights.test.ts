import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Book, ExportFile, ReadingRecord } from '../src/domain/book.js';
import { chaosMap, readingTypes } from '../src/domain/insights.js';
import { bookClass, ccodeToNdc, parseNdc } from '../src/domain/ndc.js';
import { classTargets, enrichClasses } from '../src/lookup/enrich.js';
import type { EnrichPatch } from '../src/lookup/enrich.js';
import type { FetchLike } from '../src/lookup/http.js';
import { DOMParser } from '@xmldom/xmldom';

let n = 0;
function make(
  books: Partial<Book>[],
  patch: (i: number) => Partial<ReadingRecord> = () => ({}),
): ExportFile {
  const bs: Book[] = books.map((b, i) => ({
    id: `b${i}`,
    title: `合成の本${String.fromCharCode(65 + i)}`,
    authors: [`著者${i}`],
    source: 'manual',
    ...b,
  }));
  return {
    schemaVersion: 1,
    exportedAt: '2026-11-02T00:00:00Z',
    books: bs,
    records: bs.map((b, i) => ({
      id: `r${++n}`,
      bookId: b.id,
      format: 'paper',
      status: 'finished',
      finishedAt: '2026-10-01',
      tags: [],
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      ...patch(i),
    })),
    logs: [],
  };
}
const all = { kind: 'all' } as const;

await test('parseNdc: 類と綱を読み、記号付き・不正な値も扱う', () => {
  assert.deepEqual(parseNdc('913.6'), {
    classCode: 9,
    className: '文学',
    divisionCode: '91',
    divisionName: '日本文学',
  });
  assert.equal(parseNdc('007.64')?.divisionName, '総記・情報科学');
  assert.equal(parseNdc('K913')?.divisionCode, '91');
  assert.deepEqual(parseNdc('3'), { classCode: 3, className: '社会科学' });
  assert.equal(parseNdc('E'), null);
  assert.equal(parseNdc(undefined), null);
});

await test('chaosMap: 類 → 綱でまとめ、冊数の多い順。分類なしは最後', () => {
  const data = make([
    { ndc: '913.6' },
    { ndc: '913.6' },
    { ndc: '933.7' },
    { ndc: '336.1' },
    {},
  ]);
  const map = chaosMap(data, all);
  assert.deepEqual(
    map.map((r) => [r.name, r.count]),
    [
      ['文学', 3],
      ['社会科学', 1],
      ['分類なし', 1],
    ],
  );
  assert.deepEqual(
    map[0]?.divisions.map((d) => [d.name, d.items.length]),
    [
      ['日本文学', 2],
      ['英米文学', 1],
    ],
  );
  assert.deepEqual(chaosMap(data, { kind: 'year', year: 2025 }), []);
});

await test('readingTypes: 5冊未満はデータ不足', () => {
  const d = readingTypes(make([{}, {}, {}, {}]), all);
  assert.equal(d.enough, false);
  assert.equal(d.count, 4);
});

await test('readingTypes: 長編・シリーズ・推し作家・耳読書・新刊を判定する', () => {
  const data = make(
    Array.from({ length: 6 }, (_, i) => ({
      title: `合成の物語 ${i + 1}`,
      authors: ['山田 太郎'],
      pageCount: 420,
      publishedDate: '2026-06',
      ndc: '913.6',
    })),
    (i) => ({ format: i < 2 ? 'audiobook' : 'paper' }),
  );
  const d = readingTypes(data, all);
  assert.ok(d.enough);
  const label = (axis: string) => d.types.find((t) => t.axis === axis)?.label;
  assert.equal(label('length'), '長編派');
  assert.equal(label('newness'), '新刊派');
  assert.equal(label('series'), 'シリーズ派');
  assert.equal(label('author'), '推し作家派');
  assert.equal(label('genre'), '文学一筋');
  assert.equal(label('format'), '耳読書派');
  assert.equal(d.headline, '長編・新刊・シリーズタイプ');
  assert.match(
    d.types.find((t) => t.axis === 'author')?.detail ?? '',
    /山田 太郎 6冊/,
  );
});

await test('readingTypes: しきい値の境界（220ページ以下は薄め、10年以上は古典、5ジャンルで雑食）', () => {
  const ndcs = ['913', '336', '410', '210', '007'];
  const data = make(
    ndcs.map((ndc, i) => ({
      ndc,
      pageCount: 220,
      publishedDate: '2016-01-01',
      authors: [`著者${i}`],
    })),
  );
  const d = readingTypes(data, all);
  const label = (axis: string) => d.types.find((t) => t.axis === axis)?.label;
  assert.equal(label('length'), '薄め派');
  assert.equal(label('newness'), '古典・ロングセラー派');
  assert.equal(label('genre'), '雑食派');
  assert.equal(label('author'), '開拓派');
  assert.equal(label('series'), '単発派');
  assert.equal(label('format'), '紙中心');
});

const ndlXml = (isbn: string, ndc: string, extent = '') =>
  `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><channel><item><dc:title>本</dc:title><dc:identifier xsi:type="dcndl:ISBN">${isbn}</dc:identifier><dc:subject xsi:type="dcndl:NDC10">${ndc}</dc:subject>${extent ? `<dc:extent>${extent}</dc:extent>` : ''}</item></channel></rss>`;

const parseXml = (body: string) =>
  new DOMParser({ onError: () => undefined }).parseFromString(body, 'text/xml');
const noWait = <T>(fn: () => Promise<T>) => fn();

type Reply = { status: number; body: string } | 'throw';

/** openBD（まとめて）とNDL（1冊ずつ）の合成の応答。 */
function stub(
  openbd: (isbns: string[]) => Reply,
  ndl: (isbn: string) => Reply,
  calls: string[] = [],
  rakuten: (params: URLSearchParams) => Reply = () => 'throw',
) {
  const fetch: FetchLike = (url) => {
    const u = new URL(url);
    const isbn = u.searchParams.get('isbn') ?? '';
    calls.push(u.hostname);
    const r =
      u.hostname === 'api.openbd.jp'
        ? openbd(isbn.split(','))
        : u.hostname.endsWith('rakuten.co.jp')
          ? rakuten(u.searchParams)
          : ndl(isbn);
    if (r === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({
      ok: r.status < 300,
      status: r.status,
      text: () => Promise.resolve(r.body),
    });
  };
  return { fetch, parseXml, pace: noWait };
}

const openbdItem = (isbn: string, ccode?: string, pages?: number) => ({
  summary: { isbn, title: '本' },
  onix: {
    DescriptiveDetail: {
      ...(ccode
        ? { Subject: [{ SubjectSchemeIdentifier: '78', SubjectCode: ccode }] }
        : {}),
      ...(pages
        ? { Extent: [{ ExtentType: '11', ExtentValue: `${pages}` }] }
        : {}),
    },
  },
});

const collect = () => {
  const saved: [string, EnrichPatch][] = [];
  const onBook = (id: string, patch: EnrichPatch) => {
    saved.push([id, patch]);
    return Promise.resolve();
  };
  return { saved, onBook };
};

await test('ccodeToNdc / bookClass: Cコードの内容から近い類・綱を出し、NDCを優先する', () => {
  assert.equal(ccodeToNdc('0193')?.divisionName, '日本文学');
  assert.equal(ccodeToNdc('0077')?.className, '技術');
  assert.equal(ccodeToNdc('1079')?.divisionCode, '72');
  assert.equal(ccodeToNdc('0098')?.className, '文学');
  assert.equal(ccodeToNdc('0098')?.divisionCode, undefined);
  assert.equal(ccodeToNdc('93'), null);
  assert.equal(ccodeToNdc(undefined), null);
  assert.equal(bookClass({ ndc: '007.6', ccode: '0193' })?.divisionCode, '00');
  assert.equal(bookClass({ ccode: '0193' })?.divisionCode, '91');
});

await test('classTargets / enrichClasses: openBDでまとめて引き、残りだけNDLで引く', async () => {
  const data = make([
    { isbn13: '9784000000000' },
    { isbn13: '9784003101018', ndc: '913', pageCount: 100 },
    {},
    { isbn13: '9784003101018', pageCount: 50 },
    { isbn13: '9784101010014', ccode: '0193' },
  ]);
  const targets = classTargets(data);
  assert.deepEqual(
    targets.map((b) => b.id),
    ['b0', 'b3'],
  );
  const calls: string[] = [];
  const { saved, onBook } = collect();
  const result = await enrichClasses(
    targets,
    stub(
      (isbns) => {
        assert.deepEqual(isbns, ['9784000000000', '9784003101018']);
        return {
          status: 200,
          body: JSON.stringify([
            openbdItem('9784000000000', '0193', 300),
            null,
          ]),
        };
      },
      (isbn) => ({ status: 200, body: ndlXml(isbn, '913.6', '200p') }),
      calls,
    ),
    onBook,
    () => undefined,
  );
  assert.deepEqual(result, {
    kind: 'done',
    filled: 2,
    total: 2,
    bySource: { openbd: 1, rakuten: 0, ndl: 1 },
    unreachable: {},
  });
  assert.deepEqual(saved, [
    ['b0', { ccode: '0193', pageCount: 300 }],
    ['b3', { ndc: '913.6' }],
  ]);
  assert.deepEqual(calls, ['api.openbd.jp', 'ndlsearch.ndl.go.jp']);
});

await test('enrichClasses: NDLに届かなくても、openBDで取れた分は残して終える', async () => {
  const books = make([
    { isbn13: '9784000000000' },
    ...Array.from({ length: 4 }, () => ({ isbn13: '9784003101018' })),
  ]).books;
  const { saved, onBook } = collect();
  const result = await enrichClasses(
    books,
    stub(
      () => ({
        status: 200,
        body: JSON.stringify([openbdItem('9784000000000', '0036')]),
      }),
      () => 'throw',
    ),
    onBook,
    () => undefined,
  );
  assert.deepEqual(result, {
    kind: 'done',
    filled: 1,
    total: 5,
    bySource: { openbd: 1, rakuten: 0, ndl: 0 },
    unreachable: { ndl: 'network' },
  });
  assert.equal(saved.length, 1);
});

await test('enrichClasses: どちらにも届かなければ止める。中断もできる', async () => {
  const books = make(
    Array.from({ length: 5 }, () => ({ isbn13: '9784000000000' })),
  ).books;
  const down = await enrichClasses(
    books,
    stub(
      () => 'throw',
      () => 'throw',
    ),
    () => Promise.resolve(),
    () => undefined,
  );
  assert.deepEqual(down, {
    kind: 'done',
    filled: 0,
    total: 5,
    bySource: { openbd: 0, rakuten: 0, ndl: 0 },
    unreachable: { openbd: 'network', ndl: 'network' },
  });

  const abort = new AbortController();
  let calls = 0;
  const aborted = await enrichClasses(
    books,
    stub(
      () => ({ status: 200, body: '[]' }),
      () => {
        calls++;
        if (calls === 2) abort.abort();
        return { status: 404, body: '' };
      },
    ),
    () => Promise.resolve(),
    () => undefined,
    abort.signal,
  );
  assert.equal(aborted.kind, 'aborted');
  assert.equal(calls, 2);
});

/** 楽天ブックスの合成の応答。ISBNで引くとジャンルID、ジャンルで引くと下位の名前を返す。 */
const rakutenStub =
  (genreIds: Record<string, string>, log: string[] = []) =>
  (p: URLSearchParams): Reply => {
    const isbn = p.get('isbn');
    if (isbn) {
      log.push(`isbn:${isbn}`);
      return genreIds[isbn]
        ? {
            status: 200,
            body: JSON.stringify({
              items: [{ title: '本', isbn, booksGenreId: genreIds[isbn] }],
            }),
          }
        : { status: 404, body: '{"error":"not_found"}' };
    }
    const parent = p.get('booksGenreId') ?? '';
    log.push(`genre:${parent}`);
    const children: Record<string, [string, string][]> = {
      '001': [
        ['001004', '小説・エッセイ'],
        ['001019', '文庫'],
        ['001006', 'ビジネス・経済・就職'],
      ],
      '001019': [['001019001', '小説・エッセイ']],
      '001004': [['001004008', '日本の小説']],
    };
    return {
      status: 200,
      body: JSON.stringify({
        items: [],
        GenreInformation: [
          {
            children: (children[parent] ?? []).map(([id, name]) => ({
              child: { booksGenreId: id, booksGenreName: name },
            })),
          },
        ],
      }),
    };
  };

const rakutenDeps = (
  base: ReturnType<typeof stub>,
): Parameters<typeof enrichClasses>[1] => ({
  ...base,
  rakuten: {
    config: {
      applicationId: 'app',
      endpoint:
        'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
    },
    throttle: noWait,
    cache: new Map(),
  },
});

await test('enrichClasses: openBDで取れない本は楽天ブックスのジャンル名で補う（文庫は下位を見る）', async () => {
  const books = make([
    { isbn13: '9784000000000' },
    { isbn13: '9784003101018' },
    { isbn13: '9784101010014' },
  ]).books;
  const log: string[] = [];
  const { saved, onBook } = collect();
  const result = await enrichClasses(
    books,
    rakutenDeps(
      stub(
        () => ({ status: 200, body: '[null,null,null]' }),
        () => ({ status: 404, body: '' }),
        [],
        rakutenStub(
          {
            '9784000000000': '001019001003',
            '9784003101018': '001006009',
          },
          log,
        ),
      ),
    ),
    onBook,
    () => undefined,
  );
  assert.deepEqual(saved, [
    ['b0', { rakutenGenre: '文庫 > 小説・エッセイ' }],
    ['b1', { rakutenGenre: 'ビジネス・経済・就職' }],
  ]);
  assert.deepEqual(result.bySource, { openbd: 0, rakuten: 2, ndl: 0 });
  // 上位ジャンルの一覧はキャッシュして、2冊目では問い合わせない
  assert.deepEqual(log, [
    'isbn:9784000000000',
    'genre:001',
    'genre:001019',
    'isbn:9784003101018',
    'isbn:9784101010014',
  ]);
  assert.equal(
    bookClass({ rakutenGenre: '文庫 > 小説・エッセイ' })?.divisionName,
    '日本文学',
  );
  assert.equal(
    bookClass({ rakutenGenre: 'ビジネス・経済・就職' })?.className,
    '社会科学',
  );
});

await test('enrichClasses: 楽天のIDの誤りは1回で止め、残りをNDLに回す', async () => {
  const books = make([
    { isbn13: '9784000000000' },
    { isbn13: '9784003101018' },
  ]).books;
  const calls: string[] = [];
  const result = await enrichClasses(
    books,
    rakutenDeps(
      stub(
        () => ({ status: 200, body: '[]' }),
        (isbn) => ({ status: 200, body: ndlXml(isbn, '913') }),
        calls,
        () => ({
          status: 400,
          body: '{"error":"wrong_parameter","error_description":"specify valid applicationId"}',
        }),
      ),
    ),
    () => Promise.resolve(),
    () => undefined,
  );
  assert.deepEqual(result.unreachable, { rakuten: 'auth' });
  assert.deepEqual(result.bySource, { openbd: 0, rakuten: 0, ndl: 2 });
  assert.equal(calls.filter((h) => h.endsWith('rakuten.co.jp')).length, 1);
});

await test('readingTypes / chaosMap: NDCのない本はCコードで分類する', () => {
  const data = make([{ ccode: '0193' }, { ccode: '0036' }, {}]);
  const map = chaosMap(data, all);
  assert.deepEqual(
    map.map((r) => r.name),
    ['社会科学', '文学', '分類なし'],
  );
});
