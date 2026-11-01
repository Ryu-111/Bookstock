import { BOOK_SOURCES, FORMATS, SCHEMA_VERSION, STATUSES } from './book.js';
import type { Book, ExportFile, ReadingLog, ReadingRecord } from './book.js';
import { isObject, positiveInt } from './guard.js';
import { isIsbn13 } from './isbn.js';

/**
 * 保存データ（エクスポートファイル・IndexedDB）を厳密に検証する。
 * 書誌APIのパーサーと違い、不正な項目を捨てずにエラーにする。
 */

export type Validation<T> =
  { ok: true; value: T } | { ok: false; errors: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PUB_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

class Checker {
  readonly errors: string[] = [];
  constructor(
    private readonly obj: Record<string, unknown>,
    private readonly path: string,
  ) {}

  private fail(key: string, message: string): undefined {
    this.errors.push(`${this.path}.${key}: ${message}`);
    return undefined;
  }

  string(key: string, pattern?: RegExp): string | undefined {
    const v = this.obj[key];
    if (typeof v !== 'string' || v.trim() === '')
      return this.fail(key, '空でない文字列が必要です');
    if (pattern && !pattern.test(v)) return this.fail(key, '形式が不正です');
    return v;
  }

  optString(key: string, pattern?: RegExp): string | undefined {
    return this.obj[key] === undefined ? undefined : this.string(key, pattern);
  }

  optInt(key: string): number | undefined {
    const v = this.obj[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || positiveInt(v) === undefined)
      return this.fail(key, '正の整数が必要です');
    return v;
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T | undefined {
    const v = this.obj[key];
    if (typeof v === 'string' && (values as readonly string[]).includes(v))
      return v as T;
    return this.fail(key, `${values.join(' / ')} のいずれかが必要です`);
  }

  strings(key: string): string[] | undefined {
    const v = this.obj[key];
    if (
      !Array.isArray(v) ||
      !v.every((s): s is string => typeof s === 'string')
    )
      return this.fail(key, '文字列の配列が必要です');
    return v;
  }

  isoTime(key: string): string | undefined {
    const v = this.string(key);
    if (v !== undefined && Number.isNaN(Date.parse(v)))
      return this.fail(key, '日時が不正です');
    return v;
  }
}

/** undefinedの項目を落として、exactOptionalPropertyTypesに合う形にする。 */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

export function validateBook(value: unknown, path: string): Validation<Book> {
  if (!isObject(value))
    return { ok: false, errors: [`${path}: objectが必要です`] };
  const c = new Checker(value, path);
  const isbn13 = c.optString('isbn13');
  if (isbn13 !== undefined && !isIsbn13(isbn13))
    c.errors.push(`${path}.isbn13: ISBN-13が不正です`);
  const book = compact({
    id: c.string('id'),
    isbn13,
    asin: c.optString('asin'),
    title: c.string('title'),
    titleKana: c.optString('titleKana'),
    authors: c.strings('authors'),
    publisher: c.optString('publisher'),
    publishedDate: c.optString('publishedDate', PUB_DATE),
    coverUrl: c.optString('coverUrl', /^https:\/\//),
    pageCount: c.optInt('pageCount'),
    ndc: c.optString('ndc'),
    source: c.oneOf('source', BOOK_SOURCES),
  });
  return c.errors.length > 0
    ? { ok: false, errors: c.errors }
    : { ok: true, value: book as Book };
}

export function validateRecord(
  value: unknown,
  path: string,
): Validation<ReadingRecord> {
  if (!isObject(value))
    return { ok: false, errors: [`${path}: objectが必要です`] };
  const c = new Checker(value, path);
  const rating = c.optInt('rating');
  if (rating !== undefined && rating > 5)
    c.errors.push(`${path}.rating: 1〜5が必要です`);
  const record = compact({
    id: c.string('id'),
    bookId: c.string('bookId'),
    format: c.oneOf('format', FORMATS),
    platform: c.optString('platform'),
    status: c.oneOf('status', STATUSES),
    startedAt: c.optString('startedAt', DATE),
    finishedAt: c.optString('finishedAt', DATE),
    rating,
    memo: c.optString('memo'),
    totalMinutes: c.optInt('totalMinutes'),
    tags: c.strings('tags'),
    createdAt: c.isoTime('createdAt'),
    updatedAt: c.isoTime('updatedAt'),
  });
  return c.errors.length > 0
    ? { ok: false, errors: c.errors }
    : { ok: true, value: record as ReadingRecord };
}

export function validateLog(
  value: unknown,
  path: string,
): Validation<ReadingLog> {
  if (!isObject(value))
    return { ok: false, errors: [`${path}: objectが必要です`] };
  const c = new Checker(value, path);
  const log = compact({
    id: c.string('id'),
    recordId: c.string('recordId'),
    date: c.string('date', DATE),
    pages: c.optInt('pages'),
    minutes: c.optInt('minutes'),
  });
  if (log.pages === undefined && log.minutes === undefined)
    c.errors.push(`${path}: pagesかminutesが必要です`);
  return c.errors.length > 0
    ? { ok: false, errors: c.errors }
    : { ok: true, value: log as ReadingLog };
}

function validateList<T>(
  value: unknown,
  name: string,
  validate: (item: unknown, path: string) => Validation<T>,
  errors: string[],
): T[] {
  if (!Array.isArray(value)) {
    errors.push(`${name}: 配列が必要です`);
    return [];
  }
  const items: T[] = [];
  value.forEach((item, i) => {
    const result = validate(item, `${name}[${i}]`);
    if (result.ok) items.push(result.value);
    else errors.push(...result.errors);
  });
  return items;
}

function checkUnique(items: { id: string }[], name: string, errors: string[]) {
  const seen = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) errors.push(`${name}: id ${id} が重複しています`);
    seen.add(id);
  }
}

/** schemaVersion 1 のエクスポートファイルを検証する。参照の整合性も確かめる。 */
export function validateExport(value: unknown): Validation<ExportFile> {
  if (!isObject(value))
    return { ok: false, errors: ['ファイル: JSON objectが必要です'] };
  const errors: string[] = [];
  if (value.schemaVersion !== SCHEMA_VERSION)
    errors.push(`schemaVersion: ${SCHEMA_VERSION} が必要です`);
  const exportedAt = value.exportedAt;
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt)))
    errors.push('exportedAt: 日時が必要です');
  const books = validateList(value.books, 'books', validateBook, errors);
  const records = validateList(
    value.records,
    'records',
    validateRecord,
    errors,
  );
  const logs = validateList(value.logs, 'logs', validateLog, errors);
  checkUnique(books, 'books', errors);
  checkUnique(records, 'records', errors);
  checkUnique(logs, 'logs', errors);
  const bookIds = new Set(books.map((b) => b.id));
  for (const r of records)
    if (!bookIds.has(r.bookId))
      errors.push(`records: ${r.id} の bookId ${r.bookId} がありません`);
  const recordIds = new Set(records.map((r) => r.id));
  for (const l of logs)
    if (!recordIds.has(l.recordId))
      errors.push(`logs: ${l.id} の recordId ${l.recordId} がありません`);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: exportedAt as string,
      books,
      records,
      logs,
    },
  };
}
