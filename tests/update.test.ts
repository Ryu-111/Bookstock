import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FetchLike } from '../src/lookup/http.js';
import { hasUpdate, parseVersion } from '../src/ui/update.js';

const reply =
  (status: number, body: string): FetchLike =>
  () =>
    Promise.resolve({
      ok: status < 300,
      status,
      text: () => Promise.resolve(body),
    });

await test('parseVersion: 版の印を読み、壊れた値はnull', () => {
  assert.equal(parseVersion('{"id":"abc"}'), 'abc');
  assert.equal(parseVersion('{"id":42}'), null);
  assert.equal(parseVersion('{}'), null);
  assert.equal(parseVersion('<html>'), null);
});

await test('hasUpdate: 公開中の版が違うときだけtrue。失敗は知らせない', async () => {
  const url = '/Bookstock/version.json';
  assert.equal(await hasUpdate(url, 'a', reply(200, '{"id":"b"}')), true);
  assert.equal(await hasUpdate(url, 'a', reply(200, '{"id":"a"}')), false);
  assert.equal(await hasUpdate(url, 'a', reply(404, 'Not Found')), false);
  assert.equal(await hasUpdate(url, 'a', reply(200, 'oops')), false);
  const down: FetchLike = () => Promise.reject(new TypeError('offline'));
  assert.equal(await hasUpdate(url, 'a', down), false);
});
