import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  BookCandidate,
  ExportFile,
  ReadingRecord,
} from '../src/domain/book.js';
import {
  favoriteAuthors,
  nextVolume,
  notOwned,
  ownedIndex,
  parseVolume,
  seriesLeads,
  titleKey,
} from '../src/domain/recommend.js';
import type { FetchLike } from '../src/lookup/http.js';
import {
  createThrottle,
  recommendByAuthors,
  recommendRanking,
  recommendSeries,
} from '../src/lookup/recommend.js';
import { parseRakutenGenres, rakutenUrl } from '../src/lookup/rakuten.js';

let n = 0;
const rec = (
  bookId: string,
  patch: Partial<ReadingRecord> = {},
): ReadingRecord => ({
  id: `r${++n}`,
  bookId,
  format: 'paper',
  status: 'finished',
  finishedAt: '2026-10-01',
  tags: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...patch,
});

const data: ExportFile = {
  schemaVersion: 1,
  exportedAt: '2026-11-01T00:00:00Z',
  books: [
    {
      id: 'a1',
      title: '合成の物語 1',
      authors: ['山田 太郎'],
      source: 'manual',
      isbn13: '9784000000000',
    },
    {
      id: 'a2',
      title: '合成の物語 2',
      authors: ['山田 太郎'],
      source: 'manual',
    },
    {
      id: 'b1',
      title: '架空の旅 上',
      authors: ['鈴木 花子'],
      source: 'manual',
    },
    { id: 'c1', title: '単発の本', authors: ['鈴木 花子'], source: 'manual' },
    { id: 'd1', title: '一冊だけ', authors: ['佐藤 一郎'], source: 'manual' },
  ],
  records: [
    rec('a1', { finishedAt: '2026-09-01' }),
    rec('a2', { finishedAt: '2026-10-20', rating: 5 }),
    rec('b1', { finishedAt: '2026-08-01' }),
    rec('c1', { finishedAt: '2026-07-01', rating: 2 }),
    rec('d1'),
  ],
  logs: [],
};

await test('parseVolume: 数字・第N巻・括弧・上中下を読み、巻数のない題名はnull', () => {
  assert.deepEqual(parseVolume('合成の物語 12'), {
    base: '合成の物語',
    volume: 12,
  });
  assert.deepEqual(parseVolume('合成の物語（3）'), {
    base: '合成の物語',
    volume: 3,
  });
  assert.deepEqual(parseVolume('合成の物語 第4巻'), {
    base: '合成の物語',
    volume: 4,
  });
  assert.deepEqual(parseVolume('合成の物語 5巻 特装版'), {
    base: '合成の物語',
    volume: 5,
  });
  assert.deepEqual(parseVolume('架空の旅 下'), { base: '架空の旅', volume: 3 });
  assert.equal(parseVolume('単発の本'), null);
  assert.equal(parseVolume('1984'), null);
});

await test('favoriteAuthors: 2冊以上読んだ著者を、評価を加味した点数順に返す', () => {
  assert.deepEqual(favoriteAuthors(data), ['山田 太郎', '鈴木 花子']);
});

await test('seriesLeads / nextVolume: 最近読んだシリーズから、本棚にない次の巻を選ぶ', () => {
  const leads = seriesLeads(data);
  assert.deepEqual(leads, [
    { base: '合成の物語', owned: 2 },
    { base: '架空の旅', owned: 1 },
  ]);
  const owned = ownedIndex(data);
  const found: BookCandidate[] = [
    { title: '合成の物語 5', authors: [], source: 'rakuten' },
    { title: '合成の物語 3', authors: [], source: 'rakuten' },
    { title: '合成の物語 2', authors: [], source: 'rakuten' },
    { title: '別の物語 3', authors: [], source: 'rakuten' },
  ];
  assert.equal(nextVolume(leads[0]!, found, owned)?.title, '合成の物語 3');
  assert.equal(nextVolume(leads[0]!, found.slice(2), owned), undefined);
});

await test('notOwned / ownedIndex: 本棚にある本（ISBNか題名）と重複を除く', () => {
  const owned = ownedIndex(data);
  const result = notOwned(
    [
      {
        title: '別の題名',
        authors: [],
        source: 'rakuten',
        isbn13: '9784000000000',
      },
      { title: '合成の物語　２', authors: [], source: 'rakuten' },
      { title: '新しい本', authors: [], source: 'rakuten' },
      { title: '新しい本', authors: [], source: 'rakuten' },
    ],
    owned,
  );
  assert.deepEqual(
    result.map((b) => b.title),
    ['新しい本'],
  );
  assert.equal(titleKey('合成の物語　２'), titleKey('合成の物語 2'));
});

await test('createThrottle: 呼び出しを間隔を空けて順に実行し、失敗しても次に進む', async () => {
  let clock = 0;
  const waits: number[] = [];
  const throttle = createThrottle(
    1000,
    (ms) => {
      waits.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    () => clock,
  );
  const order: number[] = [];
  await Promise.allSettled([
    throttle(() => Promise.resolve(order.push(1))),
    throttle(() => Promise.reject(new Error('x'))),
    throttle(() => Promise.resolve(order.push(3))),
  ]);
  assert.deepEqual(order, [1, 3]);
  assert.deepEqual(waits, [1000, 1000]);
});

const rakuten = {
  applicationId: 'app',
  endpoint:
    'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
};

await test('rakutenUrl: 著者・ジャンル・並び順・ジャンル情報を送る', () => {
  const u = new URL(
    rakutenUrl(rakuten, { genreId: '001004', sort: 'sales', genreInfo: true }),
  );
  assert.equal(u.searchParams.get('booksGenreId'), '001004');
  assert.equal(u.searchParams.get('sort'), 'sales');
  assert.equal(u.searchParams.get('genreInformationFlag'), '1');
  const a = new URL(
    rakutenUrl(rakuten, { author: '山田 太郎', sort: '-releaseDate' }),
  );
  assert.equal(a.searchParams.get('sort'), '-releaseDate');
});

await test('parseRakutenGenres: 下位ジャンルを読み、形の違う応答は空', () => {
  const v1 = JSON.stringify({
    GenreInformation: [
      {
        children: [
          {
            child: { booksGenreId: '001004', booksGenreName: '小説・エッセイ' },
          },
        ],
      },
    ],
  });
  const v2 = JSON.stringify({
    GenreInformation: [
      {
        children: [
          { booksGenreId: '001001', booksGenreName: '漫画（コミック）' },
          { booksGenreId: 'x' },
        ],
      },
    ],
  });
  assert.deepEqual(parseRakutenGenres(v1), [
    { id: '001004', name: '小説・エッセイ' },
  ]);
  assert.deepEqual(parseRakutenGenres(v2), [
    { id: '001001', name: '漫画（コミック）' },
  ]);
  assert.deepEqual(parseRakutenGenres('{}'), []);
  assert.deepEqual(parseRakutenGenres('x'), []);
});

function deps(handler: (url: URL) => { status: number; body: string }) {
  const urls: URL[] = [];
  const fetch: FetchLike = (url) => {
    const u = new URL(url);
    urls.push(u);
    const r = handler(u);
    return Promise.resolve({
      ok: r.status < 300,
      status: r.status,
      text: () => Promise.resolve(r.body),
    });
  };
  return {
    urls,
    deps: {
      fetch,
      rakuten,
      throttle: <T>(fn: () => Promise<T>) => fn(),
      cache: new Map<string, string>(),
    },
  };
}

const items = (titles: string[]) =>
  JSON.stringify({
    items: titles.map((title) => ({ title, author: '山田 太郎' })),
  });

await test('recommendByAuthors / recommendSeries: 楽天に問い合わせ、本棚にない本を返す。同じ問い合わせはキャッシュする', async () => {
  const { urls, deps: d } = deps((u) => {
    if (u.searchParams.get('author') === '鈴木 花子')
      return { status: 404, body: '{"error":"not_found"}' };
    return {
      status: 200,
      body: items(['合成の物語 2', '合成の物語 3', '新刊の本']),
    };
  });
  const picks: string[] = [];
  const failure = await recommendByAuthors(data, d, (p) =>
    picks.push(`${p.author}:${p.books.map((b) => b.title).join('/')}`),
  );
  assert.equal(failure, null);
  assert.deepEqual(picks, ['山田 太郎:合成の物語 3/新刊の本']);
  const series: string[] = [];
  await recommendSeries(data, d, (b) => series.push(b.title));
  assert.deepEqual(series, ['合成の物語 3']);
  const before = urls.length;
  await recommendByAuthors(data, d, () => undefined);
  assert.equal(urls.length, before); // キャッシュから
  assert.ok(urls.every((u) => u.searchParams.get('applicationId') === 'app'));
});

await test('recommendRanking: 売れている順とジャンル一覧。失敗は理由を返す', async () => {
  const ok = deps(() => ({
    status: 200,
    body: JSON.stringify({
      items: [{ title: '人気の本' }, { title: '単発の本' }],
      GenreInformation: [
        {
          children: [
            {
              child: {
                booksGenreId: '001004',
                booksGenreName: '小説・エッセイ',
              },
            },
          ],
        },
      ],
    }),
  }));
  const r = await recommendRanking(data, '001', ok.deps);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(
      r.books.map((b) => b.title),
      ['人気の本'],
    );
    assert.deepEqual(r.genres, [{ id: '001004', name: '小説・エッセイ' }]);
  }
  assert.equal(ok.urls[0]?.searchParams.get('sort'), 'sales');
  const bad = deps(() => ({ status: 429, body: '' }));
  assert.deepEqual(await recommendRanking(data, '001', bad.deps), {
    ok: false,
    reason: 'quota',
  });
});
