import { createThrottle } from '../lookup/recommend.js';

// 楽天の制限（1アプリIDにつき1秒1回）は、おすすめと分類の補完で共有して守る。
export const rakutenThrottle = createThrottle(1100);
/** 同じ問い合わせの結果を使い回す（キーにIDとキーは含めない） */
export const rakutenCache = new Map<string, string>();
