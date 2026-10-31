import type { BookCandidate } from '../domain/book.js';
import {
  httpsUrl,
  isObject,
  normalizeDate,
  positiveInt,
  text,
} from '../domain/guard.js';
import { toIsbn13 } from '../domain/isbn.js';

const BASE = 'https://www.googleapis.com/books/v1/volumes';

export function googleIsbnUrl(isbn13: string): string {
  return `${BASE}?q=${encodeURIComponent(`isbn:${isbn13}`)}`;
}

export function googleTitleUrl(query: string): string {
  return `${BASE}?q=${encodeURIComponent(`intitle:${query}`)}&maxResults=20`;
}

function isbn(identifiers: unknown): string | undefined {
  if (!Array.isArray(identifiers)) return undefined;
  for (const id of identifiers) {
    if (!isObject(id) || typeof id.identifier !== 'string') continue;
    if (id.type === 'ISBN_13' || id.type === 'ISBN_10') {
      const isbn13 = toIsbn13(id.identifier);
      if (isbn13) return isbn13;
    }
  }
  return undefined;
}

function parseItem(item: unknown): BookCandidate | undefined {
  if (!isObject(item) || !isObject(item.volumeInfo)) return undefined;
  const v = item.volumeInfo;
  const baseTitle = text(v.title);
  if (!baseTitle) return undefined;
  const subtitle = text(v.subtitle);
  const book: BookCandidate = {
    title: subtitle ? `${baseTitle} ${subtitle}` : baseTitle,
    authors: Array.isArray(v.authors)
      ? v.authors.flatMap((a) => text(a) ?? [])
      : [],
    source: 'google',
  };
  const isbn13 = isbn(v.industryIdentifiers);
  if (isbn13) book.isbn13 = isbn13;
  const publisher = text(v.publisher);
  if (publisher) book.publisher = publisher;
  const publishedDate = normalizeDate(v.publishedDate);
  if (publishedDate) book.publishedDate = publishedDate;
  const coverUrl = isObject(v.imageLinks)
    ? httpsUrl(v.imageLinks.thumbnail)
    : undefined;
  if (coverUrl) book.coverUrl = coverUrl;
  const pages = positiveInt(v.pageCount);
  if (pages) book.pageCount = pages;
  return book;
}

/** Google Books volumes の応答をパースする。該当なし・壊れた応答は空配列。 */
export function parseGoogle(body: string): BookCandidate[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  if (!isObject(data) || !Array.isArray(data.items)) return [];
  return data.items.flatMap((item) => parseItem(item) ?? []);
}
