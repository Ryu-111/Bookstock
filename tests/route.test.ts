import assert from 'node:assert/strict';
import { test } from 'node:test';
import { href, parseRoute } from '../src/ui/route.js';

await test('ハッシュを画面にし、hrefで元に戻せる', () => {
  assert.deepEqual(parseRoute(''), { page: 'shelf' });
  assert.deepEqual(parseRoute('#/'), { page: 'shelf' });
  assert.deepEqual(parseRoute('#/add'), { page: 'add' });
  assert.deepEqual(parseRoute('#/settings'), { page: 'settings' });
  assert.deepEqual(parseRoute('#/stats'), { page: 'stats' });
  assert.deepEqual(parseRoute('#/recommend'), { page: 'recommend' });
  assert.deepEqual(parseRoute('#/records/abc-1'), {
    page: 'record',
    id: 'abc-1',
  });
  const route = { page: 'record' as const, id: 'a/b c' };
  assert.deepEqual(parseRoute(href(route)), route);
});

await test('知らない形・不正なエンコードは本棚にする', () => {
  for (const hash of [
    '#/unknown',
    '#/records/',
    '#/records/a/b',
    '#/records/%E0%A4%A',
    '#/records/%20',
  ])
    assert.deepEqual(parseRoute(hash), { page: 'shelf' }, hash);
});
