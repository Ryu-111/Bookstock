import { parseRakutenConfig } from '../lookup/rakuten.js';
import type { RakutenConfig } from '../lookup/rakuten.js';

/** localStorageのうち使う部分。テストでは差し替える。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RAKUTEN_KEY = 'bookstock.rakuten';

/** このブラウザに保存した楽天の設定。壊れた値・読めない環境ではnull。 */
export function loadRakutenConfig(
  storage: StorageLike | null,
): RakutenConfig | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(RAKUTEN_KEY);
    return raw ? parseRakutenConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** 保存する。nullなら消す。保存できなければfalse。 */
export function saveRakutenConfig(
  storage: StorageLike | null,
  config: RakutenConfig | null,
): boolean {
  if (!storage) return false;
  try {
    if (config) storage.setItem(RAKUTEN_KEY, JSON.stringify(config));
    else storage.removeItem(RAKUTEN_KEY);
    return true;
  } catch {
    return false;
  }
}

/** プライベートモードなどで localStorage にアクセスできない場合はnull。 */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
