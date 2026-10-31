import type { BookCandidate } from '../domain/book.js';
import {
  httpsUrl,
  isObject,
  normalizeDate,
  positiveInt,
  stripRole,
  text,
} from '../domain/guard.js';
import { toIsbn13 } from '../domain/isbn.js';

export function openbdUrl(isbn13: string): string {
  return `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn13)}`;
}

/** ONIXのExtent（ExtentType 11 = 本文ページ数）からページ数を取る。 */
function pageCount(onix: unknown): number | undefined {
  if (!isObject(onix) || !isObject(onix.DescriptiveDetail)) return undefined;
  const extents = onix.DescriptiveDetail.Extent;
  if (!Array.isArray(extents)) return undefined;
  for (const extent of extents) {
    if (isObject(extent) && extent.ExtentType === '11')
      return positiveInt(extent.ExtentValue);
  }
  return undefined;
}

function parseItem(item: unknown): BookCandidate | undefined {
  if (!isObject(item) || !isObject(item.summary)) return undefined;
  const s = item.summary;
  const baseTitle = text(s.title);
  if (!baseTitle) return undefined;
  const volume = text(s.volume);
  const book: BookCandidate = {
    title: volume ? `${baseTitle} ${volume}` : baseTitle,
    authors: (text(s.author) ?? '')
      .split(/[\s\u3000]+/)
      .map(stripRole)
      .filter(Boolean),
    source: 'openbd',
  };
  const isbn13 = typeof s.isbn === 'string' ? toIsbn13(s.isbn) : null;
  if (isbn13) book.isbn13 = isbn13;
  const publisher = text(s.publisher);
  if (publisher) book.publisher = publisher;
  const publishedDate = normalizeDate(s.pubdate);
  if (publishedDate) book.publishedDate = publishedDate;
  const coverUrl = httpsUrl(s.cover);
  if (coverUrl) book.coverUrl = coverUrl;
  const pages = pageCount(item.onix);
  if (pages) book.pageCount = pages;
  return book;
}

/** openBD /v1/get の応答をパースする。該当なし・壊れた応答は空配列。 */
export function parseOpenbd(body: string): BookCandidate[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => parseItem(item) ?? []);
}
