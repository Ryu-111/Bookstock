import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  audibleBookmarklet,
  parseAudiblePayload,
} from '../src/lookup/audible.js';
import { href, parseRoute } from '../src/ui/route.js';

const payload = {
  v: 1,
  asin: 'B0TEST0001',
  title: 'テスト用の物語',
  authors: ['山田 太郎', ''],
  publisher: 'テスト音声',
  date: '2025-04-01',
  minutes: 615,
  cover: 'https://m.media-amazon.com/images/I/test._SL500_.jpg',
};

await test('Audible: 取り込みのJSONを本と長さにする', () => {
  assert.deepEqual(parseAudiblePayload(JSON.stringify(payload)), {
    book: {
      title: 'テスト用の物語',
      authors: ['山田 太郎'],
      asin: 'B0TEST0001',
      source: 'audible',
      publisher: 'テスト音声',
      publishedDate: '2025-04-01',
      coverUrl: 'https://m.media-amazon.com/images/I/test._SL500_.jpg',
    },
    totalMinutes: 615,
  });
});

await test('Audible: 不正な取り込みは捨て、怪しい項目は除く', () => {
  for (const raw of [
    '{',
    'null',
    JSON.stringify({ ...payload, v: 2 }),
    JSON.stringify({ ...payload, asin: 'abc' }),
    JSON.stringify({ ...payload, title: '  ' }),
    JSON.stringify({ ...payload, title: 'あ'.repeat(501) }),
  ])
    assert.equal(parseAudiblePayload(raw), undefined, raw);

  const result = parseAudiblePayload(
    JSON.stringify({
      ...payload,
      authors: 'x',
      cover: 'https://evil.example/m.media-amazon.com.jpg',
      minutes: -3,
      date: 'unknown',
    }),
  );
  assert.deepEqual(result, {
    book: {
      title: 'テスト用の物語',
      authors: [],
      asin: 'B0TEST0001',
      source: 'audible',
      publisher: 'テスト音声',
    },
  });
});

await test('Audible: 登録画面のハッシュで取り込みを受け取れる', () => {
  const route = { page: 'add' as const, audible: JSON.stringify(payload) };
  assert.deepEqual(parseRoute(href(route)), route);
  assert.deepEqual(
    parseRoute(`#/add?audible=${encodeURIComponent('{"a":"b+c&d"}')}`),
    { page: 'add', audible: '{"a":"b+c&d"}' },
  );
  assert.deepEqual(parseRoute('#/add?other=1'), { page: 'add' });
});

/** ブックマークレットを、location・fetch・alertを差し替えて動かす。 */
async function runBookmarklet(
  pageUrl: string,
  respond: (url: string) => Promise<Response>,
) {
  const code = audibleBookmarklet('https://example.github.io/Bookstock/');
  assert.ok(code.startsWith('javascript:'));
  const page = new URL(pageUrl);
  const location = {
    hostname: page.hostname,
    pathname: page.pathname,
    href: page.href,
  };
  const alerts: string[] = [];
  const requested: string[] = [];
  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const watched = new Proxy(location, {
    set(target, key, value: string) {
      if (key === 'href') {
        target.href = value;
        done();
      }
      return true;
    },
  });
  runInNewContext(code.slice('javascript:'.length), {
    location: watched,
    fetch: (url: string) => {
      requested.push(url);
      return respond(url);
    },
    alert: (m: string) => {
      alerts.push(m);
      done();
    },
    encodeURIComponent,
    JSON,
    Error,
  });
  await Promise.race([finished, new Promise((r) => setTimeout(r, 1000))]);
  return { location, alerts, requested };
}

await test('ブックマークレット: 作品ページでAPIを呼び、登録画面を開く', async () => {
  const product = {
    product: {
      asin: 'B0TEST0001',
      title: 'テスト用の物語',
      subtitle: '架空出版',
      authors: [{ asin: 'B0AUTHOR01', name: '山田 太郎' }],
      narrators: [{ name: '朗読 花子' }],
      publisher_name: 'テスト音声',
      release_date: '2025-04-01',
      runtime_length_min: 615,
      product_images: {
        500: 'https://m.media-amazon.com/images/I/test._SL500_.jpg',
      },
    },
  };
  const { location, alerts, requested } = await runBookmarklet(
    'https://www.audible.co.jp/pd/%E3%83%86%E3%82%B9%E3%83%88/B0TEST0001?ref=x',
    () => Promise.resolve(Response.json(product)),
  );
  assert.deepEqual(alerts, []);
  assert.equal(requested.length, 1);
  assert.match(
    requested[0] ?? '',
    /^https:\/\/api\.audible\.co\.jp\/1\.0\/catalog\/products\/B0TEST0001\?/,
  );
  const prefix = 'https://example.github.io/Bookstock/';
  assert.ok(location.href.startsWith(prefix));
  const route = parseRoute(new URL(location.href).hash);
  assert.equal(route.page, 'add');
  assert.deepEqual(
    route.page === 'add' && parseAudiblePayload(route.audible ?? ''),
    parseAudiblePayload(JSON.stringify(payload)),
  );
});

await test('ブックマークレット: 作品ページ以外とAPIの失敗では知らせる', async () => {
  const other = await runBookmarklet('https://example.com/pd/B0TEST0001', () =>
    Promise.reject(new Error('呼ばれない')),
  );
  assert.equal(other.requested.length, 0);
  assert.match(other.alerts[0] ?? '', /作品ページ/);

  const failed = await runBookmarklet(
    'https://www.audible.co.jp/pd/B0TEST0001',
    () => Promise.resolve(new Response('', { status: 503 })),
  );
  assert.match(failed.alerts[0] ?? '', /HTTP 503/);

  const empty = await runBookmarklet(
    'https://www.audible.co.jp/pd/B0TEST0001',
    () => Promise.resolve(Response.json({ product: {} })),
  );
  assert.match(empty.alerts[0] ?? '', /見つかりません/);
});
