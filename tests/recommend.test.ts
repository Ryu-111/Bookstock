import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  BookCandidate,
  ExportFile,
  ReadingRecord,
} from '../src/domain/book.js';
import {
  favoriteAuthors,
  favoriteGenres,
  nextVolume,
  notOwned,
  ownedIndex,
  parseVolume,
  rankForYou,
  seriesLeads,
  titleKey,
} from '../src/domain/recommend.js';
import type { Candidate } from '../src/domain/recommend.js';
import type { FetchLike } from '../src/lookup/http.js';
import {
  createThrottle,
  recommendByAuthors,
  recommendGenres,
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

const items = (titles: string[], extra: Record<string, unknown>[] = []) =>
  JSON.stringify({
    items: [
      ...titles.map((title) => ({ title, author: '山田 太郎' })),
      ...extra,
    ],
  });

await test('recommendByAuthors / recommendSeries: 楽天に問い合わせ、本棚にない本を返す。同じ問い合わせはキャッシュする', async () => {
  const { urls, deps: d } = deps((u) => {
    if (u.searchParams.get('author') === '鈴木 花子')
      return { status: 404, body: '{"error":"not_found"}' };
    return {
      status: 200,
      body: items(
        ['合成の物語 2', '合成の物語 3', '新刊の本', '別のシリーズ 1'],
        [
          { title: '合成のコミック', size: 'コミック' },
          { title: '合成の漫画', booksGenreId: '001001001/001004' },
        ],
      ),
    };
  });
  const picks: string[] = [];
  const failure = await recommendByAuthors(data, d, (p) =>
    picks.push(`${p.author}:${p.books.map((b) => b.title).join('/')}`),
  );
  assert.equal(failure, null);
  // 著者のおすすめから、シリーズの巻と漫画を除く
  assert.deepEqual(picks, ['山田 太郎:新刊の本']);
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
      items: [
        { title: '人気の本' },
        { title: '単発の本' },
        { title: '人気の漫画 12', size: 'コミック' },
        { title: '人気の小説 上', booksGenreId: '001004008' },
        { title: '人気のBL', booksGenreId: '001021001' },
        { title: '新しい単行本', booksGenreId: '001004008' },
      ],
      GenreInformation: [
        {
          children: [
            {
              child: {
                booksGenreId: '001004',
                booksGenreName: '小説・エッセイ',
              },
            },
            {
              child: {
                booksGenreId: '001001',
                booksGenreName: '漫画（コミック）',
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
      ['人気の本', '新しい単行本'],
    );
    assert.deepEqual(r.genres, [{ id: '001004', name: '小説・エッセイ' }]);
  }
  assert.equal(ok.urls[0]?.searchParams.get('sort'), 'sales');
  assert.equal(ok.urls[0]?.searchParams.get('hits'), '30');
  const bad = deps(() => ({ status: 429, body: '' }));
  assert.deepEqual(await recommendRanking(data, '001', bad.deps), {
    ok: false,
    reason: 'quota',
  });
});

/** よく読むジャンルのある本棚（日本の小説4冊、経済2冊）。 */
const tasteData: ExportFile = {
  schemaVersion: 1,
  exportedAt: '2026-11-01T00:00:00Z',
  books: [
    ...['A', 'B', 'C', 'D'].map((x) => ({
      id: `n${x}`,
      title: `小説${x}`,
      authors: [x === 'A' || x === 'B' ? '推し 作家' : `作家${x}`],
      source: 'manual' as const,
      rakutenGenre: '小説・エッセイ > 日本の小説',
    })),
    ...['E', 'F'].map((x) => ({
      id: `e${x}`,
      title: `経済${x}`,
      authors: [`学者${x}`],
      source: 'manual' as const,
      rakutenGenre: 'ビジネス・経済・就職',
    })),
    {
      id: 'm1',
      title: '漫画',
      authors: ['漫画家'],
      source: 'manual',
      rakutenGenre: '漫画（コミック） > 少年',
    },
    {
      id: 'm2',
      title: '漫画2',
      authors: ['漫画家'],
      source: 'manual',
      rakutenGenre: '漫画（コミック） > 少年',
    },
  ],
  records: [
    rec('nA', { rating: 5 }),
    rec('nB'),
    rec('nC'),
    rec('nD'),
    rec('eE'),
    rec('eF'),
    rec('m1'),
    rec('m2'),
  ],
  logs: [],
};

await test('favoriteGenres: よく読むジャンルを点数順に返し、漫画は除く', () => {
  assert.deepEqual(
    favoriteGenres(tasteData).map((g) => [g.key, g.count]),
    [
      ['小説・エッセイ > 日本の小説', 4],
      ['ビジネス・経済・就職', 2],
    ],
  );
});

await test('rankForYou: 著者・ジャンル・売れ行き・新しさで点数を付け、理由を付ける', () => {
  const book = (title: string, author: string, publishedDate?: string) => ({
    title,
    authors: [author],
    source: 'rakuten' as const,
    ...(publishedDate ? { publishedDate } : {}),
  });
  const candidates: Candidate[] = [
    {
      book: book('推しの新刊', '推し 作家', '2026-10-01'),
      genreIds: ['001004008001'],
      origin: { kind: 'author', author: '推し 作家' },
    },
    {
      book: book('売れている小説', '他の作家', '2020-01-01'),
      genreIds: ['001004008'],
      origin: { kind: 'genre', genre: '小説・エッセイ > 日本の小説', rank: 0 },
    },
    {
      book: book('売れている経済書', '経済の人'),
      genreIds: ['001006009'],
      origin: { kind: 'ranking', rank: 1 },
    },
    {
      book: book('関係ない人気本', '誰か'),
      genreIds: ['001009'],
      origin: { kind: 'ranking', rank: 0 },
    },
    {
      book: book('小説A', '推し 作家'),
      genreIds: ['001004008'],
      origin: { kind: 'author', author: '推し 作家' },
    },
    {
      book: book('続きもの 2', '推し 作家'),
      genreIds: ['001004008'],
      origin: { kind: 'author', author: '推し 作家' },
    },
  ];
  const genres = [
    {
      key: '小説・エッセイ > 日本の小説',
      count: 4,
      points: 5,
      id: '001004008',
    },
    { key: 'ビジネス・経済・就職', count: 2, points: 2, id: '001006' },
  ];
  const ranked = rankForYou(
    tasteData,
    candidates,
    genres,
    new Date('2026-11-01T00:00:00Z'),
  );
  assert.deepEqual(
    ranked.map((s) => [s.book.title, s.reasons]),
    [
      ['推しの新刊', ['よく読む著者（2冊）', 'よく読む日本の小説', '新刊']],
      ['売れている小説', ['よく読む日本の小説', '売れている（1位）']],
      [
        '売れている経済書',
        ['よく読むビジネス・経済・就職', '売れている（2位）'],
      ],
    ],
  );
});

await test('recommendGenres: ジャンル名をIDに読み替え、そのジャンルの売れている本を返す', async () => {
  const { urls, deps: d } = deps((u) => {
    const genre = u.searchParams.get('booksGenreId');
    const children: Record<string, [string, string][]> = {
      '001': [
        ['001004', '小説・エッセイ'],
        ['001006', 'ビジネス・経済・就職'],
      ],
      '001004': [['001004008', '日本の小説']],
    };
    if (u.searchParams.get('sort') === 'sales')
      return {
        status: 200,
        body: JSON.stringify({
          items: [
            {
              title: '人気の小説',
              isbn: '9784003101018',
              booksGenreId: `${genre}001`,
            },
            { title: '人気の漫画', size: 'コミック' },
            { title: '人気シリーズ 3' },
          ],
        }),
      };
    return {
      status: 200,
      body: JSON.stringify({
        items: [],
        GenreInformation: [
          {
            children: (children[genre ?? ''] ?? []).map(([id, name]) => ({
              child: { booksGenreId: id, booksGenreName: name },
            })),
          },
        ],
      }),
    };
  });
  const picks: string[] = [];
  const r = await recommendGenres(tasteData, d, (p) =>
    picks.push(`${p.genre.id}:${p.books.map((b) => b.title).join('/')}`),
  );
  assert.equal(r.failure, null);
  assert.deepEqual(
    r.genres.map((g) => g.id),
    ['001004008', '001006'],
  );
  assert.deepEqual(picks, ['001004008:人気の小説', '001006:人気の小説']);
  // 送るのはジャンルIDだけ（著者名・題名は送らない）
  assert.ok(
    urls.every(
      (u) => !u.searchParams.has('author') && !u.searchParams.has('title'),
    ),
  );
});
