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

export type Persistence = 'persisted' | 'best-effort' | 'unsupported';

/** navigator.storage のうち使う部分。テストでは差し替える。 */
export interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

/**
 * ブラウザに「容量が足りなくなっても消さない保存」を求める。
 * 許可するかはブラウザが決める（Safariはホーム画面に追加したときなど）。
 */
export async function requestPersistence(
  manager: StorageManagerLike | undefined,
): Promise<Persistence> {
  if (!manager?.persist || !manager.persisted) return 'unsupported';
  try {
    if (await manager.persisted()) return 'persisted';
    return (await manager.persist()) ? 'persisted' : 'best-effort';
  } catch {
    return 'best-effort';
  }
}

const ENRICH_KEY = 'bookstock.enrich.autoAt';
/** 自動の補完は1日に1回まで（見つからない本を毎回問い合わせないため）。 */
const ENRICH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 起動時に分類の補完を自動で始めてよいか。始めてよければ時刻を記録してtrue。
 * 保存できない環境でも、補完自体は進める。
 */
export function claimAutoEnrich(
  storage: StorageLike | null,
  now: number,
): boolean {
  try {
    const last = Number(storage?.getItem(ENRICH_KEY) ?? NaN);
    if (Number.isFinite(last) && last <= now && now - last < ENRICH_INTERVAL_MS)
      return false;
    storage?.setItem(ENRICH_KEY, String(now));
  } catch {
    // 記録できなくても続ける
  }
  return true;
}
