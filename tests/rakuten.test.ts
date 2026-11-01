import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DEFAULT_RAKUTEN_ENDPOINT,
  LEGACY_RAKUTEN_ENDPOINT,
  isRakutenEndpoint,
  parseRakuten,
  parseRakutenConfig,
  rakutenError,
  rakutenUrl,
} from '../src/lookup/rakuten.js';
import {
  loadRakutenConfig,
  requestPersistence,
  saveRakutenConfig,
} from '../src/storage/settings.js';
import type { StorageLike } from '../src/storage/settings.js';

const fixture = readFileSync(
  new URL('fixtures/rakuten.json', import.meta.url),
  'utf8',
);

await test('parseRakuten: 書誌・読み仮名・「頃」付きの日付・書影を読み、旧形式も受け付ける', () => {
  assert.deepEqual(parseRakuten(fixture), [
    {
      title: 'テスト用の本 上巻',
      authors: ['山田 太郎', '鈴木 花子'],
      source: 'rakuten',
      titleKana: 'テストヨウノホン',
      isbn13: '9784000000000',
      publisher: '架空出版',
      publishedDate: '2024-03-15',
      coverUrl: 'https://thumbnail.image.example.test/cover.jpg?_ex=200x200',
    },
    {
      title: '旧形式の本',
      authors: [],
      source: 'rakuten',
      isbn13: '9784003101018',
      publishedDate: '2021-07',
    },
  ]);
});

await test('parseRakuten: XML表記に合わせた Items / Item の形も読む', () => {
  assert.deepEqual(
    parseRakuten(
      '{"Items":[{"Item":{"title":"大文字の形","salesDate":"2020年"}}]}',
    ),
    [
      {
        title: '大文字の形',
        authors: [],
        source: 'rakuten',
        publishedDate: '2020',
      },
    ],
  );
});

await test('parseRakuten: 該当なし・壊れた応答は空配列', () => {
  assert.deepEqual(parseRakuten('{"count":0,"items":[]}'), []);
  assert.deepEqual(parseRakuten('{"error":"wrong_parameter"}'), []);
  assert.deepEqual(parseRakuten('<html>'), []);
});

await test('rakutenError: エラー応答の説明を取り出す', () => {
  assert.equal(
    rakutenError(
      '{"error":"wrong_parameter","error_description":"specify valid applicationId"}',
    ),
    'wrong_parameter: specify valid applicationId',
  );
  assert.equal(rakutenError('{"Items":[]}'), undefined);
  assert.equal(rakutenError('not json'), undefined);
  assert.equal(rakutenError(undefined), undefined);
});

await test('設定の検証: 楽天以外・http・クエリ付きのURLや不正なIDは受け付けない', () => {
  assert.deepEqual(parseRakutenConfig({ applicationId: ' abc-123 ' }), {
    applicationId: 'abc-123',
    endpoint: DEFAULT_RAKUTEN_ENDPOINT,
  });
  assert.equal(
    isRakutenEndpoint('https://openapi.rakuten.co.jp/x/Search/1'),
    true,
  );
  // 移行前の旧URLを保存していた設定は、新しい既定のURLに読み替える
  assert.equal(
    parseRakutenConfig({
      applicationId: 'a',
      endpoint: LEGACY_RAKUTEN_ENDPOINT,
    })?.endpoint,
    DEFAULT_RAKUTEN_ENDPOINT,
  );
  assert.ok(
    DEFAULT_RAKUTEN_ENDPOINT.startsWith('https://openapi.rakuten.co.jp/'),
  );
  for (const endpoint of [
    'http://app.rakuten.co.jp/services/api/BooksBook/Search/20170404',
    'https://rakuten.co.jp.example.test/api',
    'https://evil.test/?u=rakuten.co.jp',
    'https://app.rakuten.co.jp/api?x=1',
  ])
    assert.equal(
      parseRakutenConfig({ applicationId: 'a', endpoint }),
      null,
      endpoint,
    );
  assert.equal(parseRakutenConfig({ applicationId: 'a b' }), null);
  assert.equal(
    parseRakutenConfig({ applicationId: 'a', accessKey: 'x&y' }),
    null,
  );
  assert.equal(parseRakutenConfig('a'), null);
});

await test('rakutenUrl: IDとキーをクエリにする（キーは設定時のみ）', () => {
  const url = new URL(
    rakutenUrl(
      {
        applicationId: 'app',
        accessKey: 'key',
        endpoint: DEFAULT_RAKUTEN_ENDPOINT,
      },
      { isbn: '9784003101018' },
    ),
  );
  assert.equal(url.origin + url.pathname, DEFAULT_RAKUTEN_ENDPOINT);
  assert.equal(url.searchParams.get('applicationId'), 'app');
  assert.equal(url.searchParams.get('accessKey'), 'key');
  assert.equal(url.searchParams.get('isbn'), '9784003101018');
  assert.equal(url.searchParams.get('formatVersion'), '2');
  assert.equal(url.searchParams.get('outOfStockFlag'), '1');
  const title = new URL(
    rakutenUrl(
      { applicationId: 'app', endpoint: DEFAULT_RAKUTEN_ENDPOINT },
      { title: '本 & 本' },
    ),
  );
  assert.equal(title.searchParams.get('title'), '本 & 本');
  assert.equal(title.searchParams.has('accessKey'), false);
});

function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

await test('設定の保存・読み出し: 壊れた値・使えないストレージは無視する', () => {
  const storage = memoryStorage();
  const config = { applicationId: 'app', endpoint: DEFAULT_RAKUTEN_ENDPOINT };
  assert.equal(saveRakutenConfig(storage, config), true);
  assert.deepEqual(loadRakutenConfig(storage), config);
  assert.equal(saveRakutenConfig(storage, null), true);
  assert.equal(loadRakutenConfig(storage), null);
  assert.equal(
    loadRakutenConfig(memoryStorage({ 'bookstock.rakuten': '{' })),
    null,
  );
  assert.equal(
    loadRakutenConfig(
      memoryStorage({
        'bookstock.rakuten':
          '{"applicationId":"a","endpoint":"https://evil.test"}',
      }),
    ),
    null,
  );
  assert.equal(loadRakutenConfig(null), null);
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => undefined,
  };
  assert.equal(loadRakutenConfig(throwing), null);
  assert.equal(saveRakutenConfig(throwing, config), false);
});

await test('requestPersistence: 許可・拒否・非対応・失敗を分ける', async () => {
  assert.equal(await requestPersistence(undefined), 'unsupported');
  assert.equal(await requestPersistence({}), 'unsupported');
  const yes = () => Promise.resolve(true);
  const no = () => Promise.resolve(false);
  assert.equal(
    await requestPersistence({ persisted: yes, persist: no }),
    'persisted',
  );
  assert.equal(
    await requestPersistence({ persisted: no, persist: yes }),
    'persisted',
  );
  assert.equal(
    await requestPersistence({ persisted: no, persist: no }),
    'best-effort',
  );
  assert.equal(
    await requestPersistence({
      persisted: no,
      persist: () => Promise.reject(new Error('x')),
    }),
    'best-effort',
  );
});
