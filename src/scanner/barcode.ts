import { toIsbn13 } from '../domain/isbn.js';

/**
 * 読み取った値の中からISBN（978/979のEAN-13）を選ぶ。
 * 書籍JANの2段目（192始まり）や、ほかの商品のJANは無視する。
 */
export function pickIsbn(values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string' || !/^\d{13}$/.test(value)) continue;
    const isbn = toIsbn13(value);
    if (isbn) return isbn;
  }
  return null;
}

/** ネイティブのBarcodeDetectorのうち、使う部分だけの形。 */
export interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<unknown[]>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<unknown[]>;
}

/** BarcodeDetectorがあり、EAN-13に対応していればそのクラスを返す。 */
export async function nativeDetectorClass(
  scope: object = globalThis,
): Promise<NativeDetectorClass | null> {
  const ctor: unknown = Reflect.get(scope, 'BarcodeDetector');
  if (typeof ctor !== 'function') return null;
  const getSupportedFormats: unknown = Reflect.get(ctor, 'getSupportedFormats');
  if (typeof getSupportedFormats !== 'function') return null;
  try {
    const formats: unknown = await Reflect.apply(getSupportedFormats, ctor, []);
    if (!Array.isArray(formats) || !formats.includes('ean_13')) return null;
  } catch {
    return null;
  }
  return ctor as NativeDetectorClass;
}

/** detectの結果からrawValueを取り出す。 */
export function rawValues(results: unknown): string[] {
  if (!Array.isArray(results)) return [];
  return results.flatMap((r: unknown) => {
    const value: unknown =
      typeof r === 'object' && r !== null
        ? Reflect.get(r, 'rawValue')
        : undefined;
    return typeof value === 'string' ? [value] : [];
  });
}

/** カメラのエラーを利用者向けの文に変える。 */
export function cameraErrorMessage(error: unknown): string {
  const name: unknown =
    typeof error === 'object' && error !== null
      ? Reflect.get(error, 'name')
      : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'カメラの使用が許可されていません。ブラウザの設定で許可するか、ISBNを入力してください';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'カメラが見つかりません。ISBNを入力してください';
    case 'NotReadableError':
      return 'カメラをほかのアプリが使っています';
    case 'Unsupported':
      return 'このブラウザではカメラを使えません（HTTPSが必要です）';
    default:
      return 'カメラを開始できませんでした。ISBNを入力してください';
  }
}
