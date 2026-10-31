import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cameraErrorMessage,
  nativeDetectorClass,
  pickIsbn,
  rawValues,
} from '../src/scanner/barcode.js';

await test('pickIsbn: 2段バーコードからISBNだけを選ぶ', () => {
  assert.equal(pickIsbn(['1920193006001', '9784003101018']), '9784003101018');
  assert.equal(pickIsbn(['4901234567894']), null); // 一般商品のJAN
  assert.equal(pickIsbn(['9784003101019']), null); // チェックディジット違い
  assert.equal(pickIsbn(['978-4-00-310101-8', 42, null]), null); // EAN-13の生の値だけ
  assert.equal(pickIsbn([]), null);
});

await test('rawValues: detectの結果から文字列のrawValueだけを取り出す', () => {
  assert.deepEqual(
    rawValues([{ rawValue: '9784003101018' }, { rawValue: 1 }, null, 'x']),
    ['9784003101018'],
  );
  assert.deepEqual(rawValues('not array'), []);
});

function scope(formats: unknown) {
  class BarcodeDetector {
    static getSupportedFormats() {
      return formats instanceof Error
        ? Promise.reject(formats)
        : Promise.resolve(formats);
    }
  }
  return { BarcodeDetector };
}

await test('nativeDetectorClass: EAN-13に対応するときだけ使う', async () => {
  assert.ok(await nativeDetectorClass(scope(['qr_code', 'ean_13'])));
  assert.equal(await nativeDetectorClass(scope(['qr_code'])), null);
  assert.equal(await nativeDetectorClass(scope('ean_13')), null);
  assert.equal(await nativeDetectorClass(scope(new Error('x'))), null);
  assert.equal(await nativeDetectorClass({}), null); // iOS Safariなど
  assert.equal(await nativeDetectorClass({ BarcodeDetector: {} }), null);
});

await test('cameraErrorMessage: 拒否・カメラなし・使用中・非対応を分ける', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /許可/);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /見つかりません/);
  assert.match(
    cameraErrorMessage({ name: 'NotReadableError' }),
    /ほかのアプリ/,
  );
  assert.match(cameraErrorMessage({ name: 'Unsupported' }), /HTTPS/);
  assert.match(cameraErrorMessage('x'), /開始できません/);
});
