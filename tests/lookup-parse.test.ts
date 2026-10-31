import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { normalizeDate } from '../src/domain/guard.js';
import { parseGoogle } from '../src/lookup/google.js';
import { parseNdl } from '../src/lookup/ndl.js';
import type { XmlParser } from '../src/lookup/ndl.js';
import { parseOpenbd } from '../src/lookup/openbd.js';

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

// 不正なXMLはコンソールに出さず例外にする（ブラウザのparsererrorと同じく空配列になる）。
const xmlParser: XmlParser = (body) =>
  new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw new Error(message);
    },
  }).parseFromString(body, 'text/xml');

await test('openBD: summaryとONIXのページ数を読む', () => {
  assert.deepEqual(parseOpenbd(fixture('openbd.json')), [
    {
      title: 'テスト用の本 上',
      authors: ['山田太郎', '鈴木花子'],
      source: 'openbd',
      isbn13: '9784000000000',
      publisher: '架空出版',
      publishedDate: '2024-03-15',
      pageCount: 320,
    },
  ]);
});

await test('openBD: 該当なし・壊れた応答は空配列', () => {
  assert.deepEqual(parseOpenbd('[null]'), []);
  assert.deepEqual(parseOpenbd('{"summary":{}}'), []);
  assert.deepEqual(parseOpenbd('not json'), []);
  assert.deepEqual(parseOpenbd('[{"summary":{"title":42}}]'), []);
});

await test('NDL: RSSのitemを読み、タイトルのないitemは捨てる', () => {
  const books = parseNdl(fixture('ndl.xml'), xmlParser);
  assert.deepEqual(books, [
    {
      title: 'テスト用の本 上',
      authors: ['山田 太郎', '鈴木 花子'],
      source: 'ndl',
      isbn13: '9784000000000',
      coverUrl: 'https://ndlsearch.ndl.go.jp/thumbnail/9784000000000.jpg',
      publisher: '架空出版',
      publishedDate: '2024-03',
      ndc: '913.6',
      pageCount: 318,
    },
    { title: 'ISBNのない資料', authors: [], source: 'ndl' },
  ]);
});

await test('NDL: 空のRSS・壊れたXMLは空配列', () => {
  assert.deepEqual(parseNdl('<rss><channel></channel></rss>', xmlParser), []);
  assert.deepEqual(parseNdl('<rss><item>', xmlParser), []);
  assert.deepEqual(
    parseNdl('x', () => {
      throw new Error('parse');
    }),
    [],
  );
});

await test('Google: volumeInfoを読み、型違いの項目を捨て、書影をhttps化する', () => {
  assert.deepEqual(parseGoogle(fixture('google.json')), [
    {
      title: 'Synthetic Book A Test',
      authors: ['Jane Example'],
      source: 'google',
      isbn13: '9784003101018',
      publisher: 'Example Press',
      publishedDate: '2021-07',
      coverUrl: 'https://books.example.test/cover.jpg',
      pageCount: 250,
    },
  ]);
});

await test('Google: 該当なし・壊れた応答は空配列', () => {
  assert.deepEqual(parseGoogle('{"totalItems":0}'), []);
  assert.deepEqual(parseGoogle('{'), []);
});

await test('出版日の表記をそろえる', () => {
  assert.equal(normalizeDate('20240315'), '2024-03-15');
  assert.equal(normalizeDate('202403'), '2024-03');
  assert.equal(normalizeDate('2024.3'), '2024-03');
  assert.equal(normalizeDate('2024年3月5日'), '2024-03-05');
  assert.equal(normalizeDate('2024-13'), '2024');
  assert.equal(normalizeDate('c2024'), undefined);
  assert.equal(normalizeDate(2024), undefined);
});
