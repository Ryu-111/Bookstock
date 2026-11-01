import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { fetchText } from '../src/lookup/http.js';
import type { FetchLike } from '../src/lookup/http.js';
import { lookupIsbn, searchBooks, testRakuten } from '../src/lookup/index.js';
import type { LookupDeps } from '../src/lookup/index.js';
import { parseNdl } from '../src/lookup/ndl.js';

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

type Reply = { status: number; body?: string } | 'throw' | 'hang';

/** URLのホスト名ごとに応答を返すスタブ。呼ばれたホストを記録する。 */
function stub(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const fetch: FetchLike = (url, { signal }) => {
    const host = new URL(url).hostname;
    calls.push(host);
    const reply = replies[host] ?? { status: 404 };
    if (reply === 'throw')
      return Promise.reject(new TypeError('Failed to fetch'));
    if (reply === 'hang')
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: () => Promise.resolve(reply.body ?? ''),
    });
  };
  return { fetch, calls };
}

const parseXml = (body: string) =>
  new DOMParser({ onError: () => undefined }).parseFromString(body, 'text/xml');

const deps = (fetch: FetchLike): LookupDeps => ({
  fetch,
  parseXml,
  timeoutMs: 50,
});

const OPENBD = 'api.openbd.jp';
const NDL = 'ndlsearch.ndl.go.jp';
const GOOGLE = 'www.googleapis.com';

await test('fetchText: 成功・HTTPエラー・上限・通信失敗・タイムアウト', async () => {
  const { fetch } = stub({
    'a.test': { status: 200, body: 'ok' },
    'b.test': { status: 404 },
    'c.test': { status: 429 },
    'd.test': 'throw',
    'e.test': 'hang',
  });
  assert.deepEqual(await fetchText('https://a.test/', fetch, 50), {
    ok: true,
    status: 200,
    text: 'ok',
  });
  assert.deepEqual(await fetchText('https://b.test/', fetch, 50), {
    ok: false,
    reason: 'http',
    status: 404,
    body: '',
  });
  assert.deepEqual(await fetchText('https://c.test/', fetch, 50), {
    ok: false,
    reason: 'quota',
    status: 429,
    body: '',
  });
  assert.deepEqual(await fetchText('https://d.test/', fetch, 50), {
    ok: false,
    reason: 'network',
  });
  assert.deepEqual(await fetchText('https://e.test/', fetch, 20), {
    ok: false,
    reason: 'timeout',
  });
});

await test('lookupIsbn: openBDにない書影とNDCをNDLで補い、そろったらGoogleを呼ばない', async () => {
  const { fetch, calls } = stub({
    [OPENBD]: { status: 200, body: fixture('openbd.json') },
    [NDL]: { status: 200, body: fixture('ndl.xml') },
  });
  const result = await lookupIsbn('978-4-00-000000-0', deps(fetch));
  assert.ok(result.ok);
  assert.deepEqual(calls, [OPENBD, NDL]);
  assert.equal(result.book?.source, 'openbd');
  assert.equal(result.book?.pageCount, 320);
  assert.equal(result.book?.ndc, '913.6');
  assert.equal(
    result.book?.coverUrl,
    'https://ndlsearch.ndl.go.jp/thumbnail/9784000000000.jpg',
  );
  assert.deepEqual(result.attempts, [
    { source: 'openbd', outcome: 'found' },
    { source: 'ndl', outcome: 'found' },
  ]);
});

await test('lookupIsbn: openBDが失敗してもNDLの結果を返す', async () => {
  const { fetch } = stub({
    [OPENBD]: 'throw',
    [NDL]: { status: 200, body: fixture('ndl.xml') },
  });
  const result = await lookupIsbn('9784000000000', deps(fetch));
  assert.ok(result.ok);
  assert.equal(result.book?.source, 'ndl');
  assert.deepEqual(result.attempts, [
    { source: 'openbd', outcome: 'network' },
    { source: 'ndl', outcome: 'found' },
  ]);
});

await test('lookupIsbn: 全部失敗したらbookはnullで、各sourceの理由を返す', async () => {
  const { fetch } = stub({
    [OPENBD]: { status: 200, body: '[null]' },
    [NDL]: 'hang',
    [GOOGLE]: { status: 429 },
  });
  const result = await lookupIsbn('9784000000000', deps(fetch));
  assert.deepEqual(result, {
    ok: true,
    book: null,
    attempts: [
      { source: 'openbd', outcome: 'not_found' },
      { source: 'ndl', outcome: 'timeout' },
      { source: 'google', outcome: 'quota' },
    ],
  });
});

await test('lookupIsbn: ISBNでない入力（書籍JANの2段目など）はfetchしない', async () => {
  const { fetch, calls } = stub({});
  assert.deepEqual(await lookupIsbn('1920193006001', deps(fetch)), {
    ok: false,
    error: 'invalid_isbn',
  });
  assert.deepEqual(calls, []);
});

await test('searchBooks（タイトル）: 片方が失敗しても結果を返し、同じISBNはまとめる', async () => {
  const google = JSON.stringify({
    items: [
      {
        volumeInfo: {
          title: 'テスト用の本 上',
          industryIdentifiers: [
            { type: 'ISBN_13', identifier: '9784000000000' },
          ],
          imageLinks: { thumbnail: 'http://books.example.test/x.jpg' },
        },
      },
    ],
  });
  const both = stub({
    [NDL]: { status: 200, body: fixture('ndl.xml') },
    [GOOGLE]: { status: 200, body: google },
  });
  const merged = await searchBooks('テスト', 'title', deps(both.fetch));
  assert.equal(merged.books.length, 2);
  assert.equal(merged.books[0]?.source, 'ndl');

  const ndlDown = stub({
    [NDL]: 'throw',
    [GOOGLE]: { status: 200, body: google },
  });
  const partial = await searchBooks('テスト', 'title', deps(ndlDown.fetch));
  assert.deepEqual(
    partial.books.map((b) => b.source),
    ['google'],
  );
  assert.deepEqual(partial.attempts, [
    { source: 'ndl', outcome: 'network' },
    { source: 'google', outcome: 'found' },
  ]);

  const empty = stub({});
  assert.deepEqual(await searchBooks('  ', 'title', deps(empty.fetch)), {
    books: [],
    attempts: [],
  });
  assert.deepEqual(empty.calls, []);
});

await test('NDL: ブラウザのparsererror文書は空配列', () => {
  const doc = {
    getElementsByTagName: (name: string) =>
      name === 'parsererror' ? [{} as never] : [],
  };
  assert.deepEqual(
    parseNdl('<x', () => doc),
    [],
  );
});

const RAKUTEN = 'openapi.rakuten.co.jp';
const rakuten = {
  applicationId: 'app',
  endpoint:
    'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
};

await test('lookupIsbn: 楽天の設定があれば最初に引き、ページ数はNDLで補う', async () => {
  const { fetch, calls } = stub({
    [RAKUTEN]: { status: 200, body: fixture('rakuten.json') },
    [OPENBD]: { status: 200, body: '[null]' },
    [NDL]: { status: 200, body: fixture('ndl.xml') },
  });
  const result = await lookupIsbn('9784000000000', { ...deps(fetch), rakuten });
  assert.ok(result.ok);
  assert.deepEqual(calls, [RAKUTEN, OPENBD, NDL]);
  assert.equal(result.book?.source, 'rakuten');
  assert.equal(result.book?.titleKana, 'テストヨウノホン');
  assert.equal(result.book?.pageCount, 318);
  assert.equal(result.book?.ndc, '913.6');
});

await test('lookupIsbn: 楽天の設定がなければ呼ばない。IDエラーは理由付きで返す', async () => {
  const none = stub({});
  await lookupIsbn('9784000000000', deps(none.fetch));
  assert.equal(none.calls.includes(RAKUTEN), false);

  const bad = stub({
    [RAKUTEN]: {
      status: 400,
      body: '{"error":"wrong_parameter","error_description":"specify valid applicationId"}',
    },
  });
  const result = await lookupIsbn('9784000000000', {
    ...deps(bad.fetch),
    rakuten,
  });
  assert.ok(result.ok);
  assert.deepEqual(result.attempts[0], {
    source: 'rakuten',
    outcome: 'auth',
    detail: 'HTTP 400: wrong_parameter: specify valid applicationId',
  });
  const t = await testRakuten(rakuten, deps(bad.fetch));
  assert.equal(t.outcome, 'auth');

  // 該当なし（404 not_found）と、IDに関係しないパラメータの誤り
  const missing = stub({
    [RAKUTEN]: {
      status: 404,
      body: '{"error":"not_found","error_description":"not found"}',
    },
  });
  assert.equal(
    (await testRakuten(rakuten, deps(missing.fetch))).outcome,
    'not_found',
  );
  const param = stub({
    [RAKUTEN]: {
      status: 400,
      body: '{"error":"wrong_parameter","error_description":"hits must be 1-30"}',
    },
  });
  const p = await testRakuten(rakuten, deps(param.fetch));
  assert.deepEqual(p, {
    source: 'rakuten',
    outcome: 'http',
    detail: 'HTTP 400: wrong_parameter: hits must be 1-30',
  });
});

await test('searchBooks（著者）: 3つのAPIに著者の条件で問い合わせる', async () => {
  const urls: string[] = [];
  const fetch: FetchLike = (url) => {
    urls.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}'),
    });
  };
  await searchBooks(' 山田 太郎 ', 'author', { ...deps(fetch), rakuten });
  const params = urls.map((u) => new URL(u));
  assert.equal(params[0]?.searchParams.get('author'), '山田 太郎');
  assert.equal(params[0]?.searchParams.has('title'), false);
  assert.equal(params[1]?.searchParams.get('creator'), '山田 太郎');
  assert.equal(params[2]?.searchParams.get('q'), 'inauthor:山田 太郎');
});

await test('楽天: 403で想定外の本文なら、許可サイトのエラーとしてステータスと本文を出し、IDは伏せ字にする', async () => {
  const id = '03d9d44a-0000-0000-0000-000000000000';
  const forbidden = stub({
    [RAKUTEN]: {
      status: 403,
      body: `{"errors":{"errorCode":403,"errorMessage":"Referer not allowed for ${id}"}}`,
    },
  });
  const a = await testRakuten(
    { ...rakuten, applicationId: id },
    deps(forbidden.fetch),
  );
  assert.equal(a.outcome, 'auth');
  assert.equal(a.detail, 'HTTP 403: Referer not allowed for ***');
  const html = stub({
    [RAKUTEN]: {
      status: 403,
      body: '<html><body><h1>Forbidden</h1></body></html>',
    },
  });
  assert.equal(
    (await testRakuten(rakuten, deps(html.fetch))).detail,
    'HTTP 403: Forbidden',
  );
});
