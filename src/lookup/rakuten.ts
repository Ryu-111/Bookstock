import type { BookCandidate } from '../domain/book.js';
import {
  httpsUrl,
  isObject,
  normalizeDate,
  stripRole,
  text,
} from '../domain/guard.js';
import { toIsbn13 } from '../domain/isbn.js';

/**
 * 楽天ブックス書籍検索API。2026年2月の移行で接続先が openapi.rakuten.co.jp になり、
 * UUID形式の applicationId と accessKey の両方が必要になった（複数の開発者の報告。
 * 公式ページは開発環境から未確認）。違っていれば設定画面でURLを差し替えられる。
 */
export const DEFAULT_RAKUTEN_ENDPOINT =
  'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404';

/** 移行前の旧URL。保存済みの設定にあれば新しいURLに読み替える。 */
export const LEGACY_RAKUTEN_ENDPOINT =
  'https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404';

export interface RakutenConfig {
  applicationId: string;
  /** 2026年以降のIDでは必須。 */
  accessKey?: string;
  endpoint: string;
}

/** キーを楽天以外に送らないため、https の rakuten.co.jp だけを許す。 */
export function isRakutenEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'rakuten.co.jp' ||
        url.hostname.endsWith('.rakuten.co.jp')) &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

const ID = /^[\w-]{1,128}$/;

/** 保存値などの外部入力を検証する。不正ならnull。 */
export function parseRakutenConfig(value: unknown): RakutenConfig | null {
  if (!isObject(value)) return null;
  const applicationId = text(value.applicationId);
  const accessKey = text(value.accessKey);
  const saved = text(value.endpoint);
  const endpoint =
    !saved || saved === LEGACY_RAKUTEN_ENDPOINT
      ? DEFAULT_RAKUTEN_ENDPOINT
      : saved;
  if (!applicationId || !ID.test(applicationId)) return null;
  if (accessKey !== undefined && !ID.test(accessKey)) return null;
  if (!isRakutenEndpoint(endpoint)) return null;
  return accessKey
    ? { applicationId, accessKey, endpoint }
    : { applicationId, endpoint };
}

export function rakutenUrl(
  config: RakutenConfig,
  query: { isbn: string } | { title: string },
): string {
  const params = new URLSearchParams({
    format: 'json',
    formatVersion: '2',
    applicationId: config.applicationId,
    hits: '20',
  });
  if (config.accessKey) params.set('accessKey', config.accessKey);
  if ('isbn' in query) params.set('isbn', query.isbn);
  else params.set('title', query.title);
  return `${config.endpoint}?${params.toString()}`;
}

/** 「著者A/著者B」の形を分ける。 */
function authors(value: unknown): string[] {
  return (text(value) ?? '').split(/[/／]/).map(stripRole).filter(Boolean);
}

function parseItem(raw: unknown): BookCandidate | undefined {
  // formatVersion=1 は { Item: {...} }、2 は {...} のまま返る。
  const item = isObject(raw) && isObject(raw.Item) ? raw.Item : raw;
  if (!isObject(item)) return undefined;
  const baseTitle = text(item.title);
  if (!baseTitle) return undefined;
  const subTitle = text(item.subTitle);
  const book: BookCandidate = {
    title: subTitle ? `${baseTitle} ${subTitle}` : baseTitle,
    authors: authors(item.author),
    source: 'rakuten',
  };
  const titleKana = text(item.titleKana);
  if (titleKana) book.titleKana = titleKana;
  const isbn13 = typeof item.isbn === 'string' ? toIsbn13(item.isbn) : null;
  if (isbn13) book.isbn13 = isbn13;
  const publisher = text(item.publisherName);
  if (publisher) book.publisher = publisher;
  const publishedDate = normalizeDate(item.salesDate);
  if (publishedDate) book.publishedDate = publishedDate;
  const coverUrl = httpsUrl(item.largeImageUrl);
  if (coverUrl) book.coverUrl = coverUrl;
  return book;
}

/** 書籍検索APIの応答をパースする。該当なし・壊れた応答は空配列。 */
export function parseRakuten(body: string): BookCandidate[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  if (!isObject(data) || !Array.isArray(data.Items)) return [];
  return data.Items.flatMap((item) => parseItem(item) ?? []);
}

/** エラー応答（{"error": "...", "error_description": "..."}）の説明文。 */
export function rakutenError(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const data: unknown = JSON.parse(body);
    if (!isObject(data)) return undefined;
    const description = text(data.error_description);
    const code = text(data.error);
    if (!description && !code) return undefined;
    return [code, description].filter(Boolean).join(': ').slice(0, 200);
  } catch {
    return undefined;
  }
}
