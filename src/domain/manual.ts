import { FORMATS, STATUSES } from './book.js';
import type { BookCandidate, NewRecord } from './book.js';
import { normalizeDate, oneOf, positiveInt, text } from './guard.js';
import { toIsbn13 } from './isbn.js';
import type { Validation } from './validate.js';

export interface ManualFields {
  title: string;
  authors: string;
  publisher: string;
  publishedDate: string;
  pageCount: string;
  isbn: string;
}

export const emptyManualFields: ManualFields = {
  title: '',
  authors: '',
  publisher: '',
  publishedDate: '',
  pageCount: '',
  isbn: '',
};

/** 手入力の内容を本の候補にする。著者は「、」「,」「/」や改行で区切る。 */
export function parseManualBook(
  fields: ManualFields,
): Validation<BookCandidate> {
  const errors: string[] = [];
  const title = text(fields.title);
  if (!title) errors.push('タイトルを入力してください');
  const book: BookCandidate = {
    title: title ?? '',
    authors: fields.authors
      .split(/[、,，/／\n]/)
      .map((a) => a.trim())
      .filter(Boolean),
    source: 'manual',
  };
  const publisher = text(fields.publisher);
  if (publisher) book.publisher = publisher;
  if (text(fields.publishedDate)) {
    const date = normalizeDate(fields.publishedDate);
    if (date) book.publishedDate = date;
    else
      errors.push('出版日は 2024、2024-03、2024-03-15 の形で入力してください');
  }
  if (text(fields.pageCount)) {
    const pages = positiveInt(fields.pageCount);
    if (pages) book.pageCount = pages;
    else errors.push('ページ数は正の整数で入力してください');
  }
  if (text(fields.isbn)) {
    const isbn = toIsbn13(fields.isbn);
    if (isbn) book.isbn13 = isbn;
    else errors.push('ISBNが正しくありません（空欄でも登録できます）');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: book };
}

export interface RecordFields {
  format: string;
  status: string;
  platform: string;
  /** 読書中は開始日、読了は読了日。YYYY-MM-DD */
  date: string;
  totalMinutes: string;
}

/** 保存フォームの内容を記録の入力にする。 */
export function parseRecordFields(fields: RecordFields): Validation<NewRecord> {
  const errors: string[] = [];
  const format = oneOf(FORMATS, fields.format);
  const status = oneOf(STATUSES, fields.status);
  if (!format) errors.push('形式を選んでください');
  if (!status) errors.push('状態を選んでください');
  if (!format || !status) return { ok: false, errors };
  const record: NewRecord = { format, status };
  const platform = text(fields.platform);
  if (platform && format !== 'paper') record.platform = platform;
  if (status === 'reading' || status === 'finished') {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fields.date) ||
      Number.isNaN(Date.parse(fields.date))
    )
      errors.push('日付を入力してください');
    else if (status === 'reading') record.startedAt = fields.date;
    else record.finishedAt = fields.date;
  }
  if (format === 'audiobook' && text(fields.totalMinutes)) {
    const minutes = positiveInt(fields.totalMinutes);
    if (minutes) record.totalMinutes = minutes;
    else errors.push('長さは分の整数で入力してください');
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: record };
}
