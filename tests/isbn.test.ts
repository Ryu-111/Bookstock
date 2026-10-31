import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isIsbn10, isIsbn13, toIsbn13 } from '../src/domain/isbn.js';

await test('正しいISBN-13を受け付ける', () => {
  assert.equal(isIsbn13('9784003101018'), true);
  assert.equal(isIsbn13('978-4-00-310101-8'), true);
});

await test('チェックディジット違い・978/979以外を拒否する', () => {
  assert.equal(isIsbn13('9784003101019'), false);
  assert.equal(isIsbn13('1920193006001'), false);
  assert.equal(isIsbn13('4901234567894'), false);
});

await test('ISBN-10を検証してISBN-13へ変換する', () => {
  assert.equal(isIsbn10('4003101014'), true);
  assert.equal(isIsbn10('080442957X'), true);
  assert.equal(toIsbn13('4-00-310101-4'), '9784003101018');
  assert.equal(toIsbn13('080442957X'), '9780804429573');
});

await test('ISBNでない入力はnullを返す', () => {
  assert.equal(toIsbn13('1920193006001'), null);
  assert.equal(toIsbn13(''), null);
  assert.equal(toIsbn13('abc'), null);
});
