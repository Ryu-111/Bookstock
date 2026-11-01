import { FORMATS, STATUSES } from './book.js';
import type {
  Book,
  BookCandidate,
  Format,
  NewRecord,
  ReadingLog,
  ReadingRecord,
} from './book.js';
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

/** 本を手入力フォームの値にする（本の情報の編集に使う）。 */
export function bookToFields(book: BookCandidate): ManualFields {
  return {
    title: book.title,
    authors: book.authors.join('、'),
    publisher: book.publisher ?? '',
    publishedDate: book.publishedDate ?? '',
    pageCount: book.pageCount ? String(book.pageCount) : '',
    isbn: book.isbn13 ?? '',
  };
}

/** 手入力フォームの値で既存の本を更新する。idと書影・分類は引き継ぐ。 */
export function applyBookEdit(
  book: Book,
  fields: ManualFields,
): Validation<Book> {
  const parsed = parseManualBook(fields);
  if (!parsed.ok) return parsed;
  const next: Book = { ...parsed.value, id: book.id };
  if (book.coverUrl) next.coverUrl = book.coverUrl;
  if (book.ndc) next.ndc = book.ndc;
  if (book.asin) next.asin = book.asin;
  return { ok: true, value: next };
}

export interface RecordEditFields {
  format: string;
  status: string;
  platform: string;
  startedAt: string;
  finishedAt: string;
  /** '' = 評価なし */
  rating: string;
  memo: string;
  totalMinutes: string;
  /** 「、」「,」区切り */
  tags: string;
}

export function recordToFields(record: ReadingRecord): RecordEditFields {
  return {
    format: record.format,
    status: record.status,
    platform: record.platform ?? '',
    startedAt: record.startedAt ?? '',
    finishedAt: record.finishedAt ?? '',
    rating: record.rating ? String(record.rating) : '',
    memo: record.memo ?? '',
    totalMinutes: record.totalMinutes ? String(record.totalMinutes) : '',
    tags: record.tags.join('、'),
  };
}

export function parseTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[、,，\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

const RATINGS = [1, 2, 3, 4, 5] as const;

/** 編集フォームの値を現在の記録に当てる。id・本・作成日時は変えない。 */
export function parseRecordEdit(
  fields: RecordEditFields,
  current: ReadingRecord,
): Validation<ReadingRecord> {
  const errors: string[] = [];
  const format = oneOf(FORMATS, fields.format);
  const status = oneOf(STATUSES, fields.status);
  if (!format) errors.push('形式を選んでください');
  if (!status) errors.push('状態を選んでください');
  const next: ReadingRecord = {
    id: current.id,
    bookId: current.bookId,
    format: format ?? current.format,
    status: status ?? current.status,
    tags: parseTags(fields.tags),
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  };
  const platform = text(fields.platform);
  if (platform && next.format !== 'paper') next.platform = platform;
  for (const key of ['startedAt', 'finishedAt'] as const) {
    const value = fields[key].trim();
    if (!value) continue;
    if (isDate(value)) next[key] = value;
    else
      errors.push(
        `${key === 'startedAt' ? '開始日' : '読了日'}が正しくありません`,
      );
  }
  if (next.startedAt && next.finishedAt && next.startedAt > next.finishedAt)
    errors.push('開始日は読了日より前にしてください');
  if (fields.rating.trim()) {
    const rating = RATINGS.find((r) => String(r) === fields.rating.trim());
    if (rating) next.rating = rating;
    else errors.push('評価は1〜5で選んでください');
  }
  const memo = text(fields.memo);
  if (memo) next.memo = memo;
  if (next.format === 'audiobook' && text(fields.totalMinutes)) {
    const minutes = positiveInt(fields.totalMinutes);
    if (minutes) next.totalMinutes = minutes;
    else errors.push('長さは分の整数で入力してください');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: next };
}

export type NewLog = Omit<ReadingLog, 'id' | 'recordId'>;

/** 進捗の入力。オーディオブックは分、それ以外はページ数として扱う。 */
export function parseLogFields(
  fields: { date: string; amount: string },
  format: Format,
): Validation<NewLog> {
  const errors: string[] = [];
  if (!isDate(fields.date)) errors.push('日付を入力してください');
  const amount = positiveInt(fields.amount);
  if (!amount)
    errors.push(
      format === 'audiobook'
        ? '聴いた時間を分の整数で入力してください'
        : 'ページ数を正の整数で入力してください',
    );
  if (errors.length > 0 || !amount) return { ok: false, errors };
  return {
    ok: true,
    value:
      format === 'audiobook'
        ? { date: fields.date, minutes: amount }
        : { date: fields.date, pages: amount },
  };
}
