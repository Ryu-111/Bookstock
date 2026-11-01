import type { BookCandidate } from '../domain/book.js';
import {
  normalizeDate,
  positiveInt,
  stripRole,
  text,
} from '../domain/guard.js';
import { toIsbn13 } from '../domain/isbn.js';
import type { SearchField } from './http.js';

const BASE = 'https://ndlsearch.ndl.go.jp/api/opensearch';
const NS = {
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
};

/** ブラウザのDOMParserとxmldomの両方が満たす最小限の形。 */
export interface XmlElement {
  readonly textContent: string | null;
  getAttributeNS(namespace: string, name: string): string | null;
  getElementsByTagNameNS(
    namespace: string,
    name: string,
  ): ArrayLike<XmlElement>;
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}
export interface XmlDocument {
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}
export type XmlParser = (body: string) => XmlDocument;

export function ndlIsbnUrl(isbn13: string): string {
  return `${BASE}?isbn=${encodeURIComponent(isbn13)}`;
}

export function ndlSearchUrl(field: SearchField, query: string): string {
  const param = field === 'author' ? 'creator' : 'title';
  return `${BASE}?${param}=${encodeURIComponent(query)}&cnt=20`;
}

export function ndlThumbnailUrl(isbn13: string): string {
  return `https://ndlsearch.ndl.go.jp/thumbnail/${isbn13}.jpg`;
}

function all(el: XmlElement, ns: string, name: string): XmlElement[] {
  return Array.from(el.getElementsByTagNameNS(ns, name));
}

function first(el: XmlElement, ns: string, name: string): string | undefined {
  for (const child of all(el, ns, name)) {
    const value = text(child.textContent);
    if (value) return value;
  }
  return undefined;
}

function typed(
  el: XmlElement,
  name: string,
  types: string[],
): string | undefined {
  for (const type of types) {
    for (const child of all(el, NS.dc, name)) {
      if (child.getAttributeNS(NS.xsi, 'type') !== type) continue;
      const value = text(child.textContent);
      if (value) return value;
    }
  }
  return undefined;
}

function parseItem(item: XmlElement): BookCandidate | undefined {
  const title = first(item, NS.dc, 'title');
  if (!title) return undefined;
  const authors = all(item, NS.dc, 'creator')
    .flatMap((c) => text(c.textContent) ?? [])
    .map(stripRole)
    .filter(Boolean);
  const book: BookCandidate = { title, authors, source: 'ndl' };
  const isbnText = typed(item, 'identifier', ['dcndl:ISBN']);
  const isbn13 = isbnText ? toIsbn13(isbnText) : null;
  if (isbn13) {
    book.isbn13 = isbn13;
    book.coverUrl = ndlThumbnailUrl(isbn13);
  }
  const publisher = first(item, NS.dc, 'publisher');
  if (publisher) book.publisher = publisher;
  const publishedDate = normalizeDate(first(item, NS.dcterms, 'issued'));
  if (publishedDate) book.publishedDate = publishedDate;
  const ndc = typed(item, 'subject', [
    'dcndl:NDC10',
    'dcndl:NDC9',
    'dcndl:NDC8',
  ]);
  if (ndc) book.ndc = ndc;
  const extent = first(item, NS.dc, 'extent');
  const pages = positiveInt(/(\d+)\s*p/.exec(extent ?? '')?.[1]);
  if (pages) book.pageCount = pages;
  return book;
}

/** NDLサーチ OpenSearch（RSS）の応答をパースする。壊れたXMLは空配列。 */
export function parseNdl(body: string, parseXml: XmlParser): BookCandidate[] {
  let root: XmlDocument;
  try {
    root = parseXml(body);
  } catch {
    return [];
  }
  if (root.getElementsByTagName('parsererror').length > 0) return [];
  return Array.from(root.getElementsByTagName('item')).flatMap(
    (item) => parseItem(item) ?? [],
  );
}

/** ブラウザ用のXMLパーサー。 */
export function browserXmlParser(body: string): XmlDocument {
  return new DOMParser().parseFromString(body, 'application/xml');
}
