export type Format = 'paper' | 'ebook' | 'audiobook';
export type Status = 'want' | 'stacked' | 'reading' | 'finished' | 'dropped';
export type BookSource = 'openbd' | 'ndl' | 'google' | 'manual';

export interface Book {
  id: string;
  isbn13?: string;
  asin?: string;
  title: string;
  authors: string[];
  publisher?: string;
  /** YYYY / YYYY-MM / YYYY-MM-DD */
  publishedDate?: string;
  coverUrl?: string;
  pageCount?: number;
  /** 日本十進分類 */
  ndc?: string;
  source: BookSource;
}

/** 検索結果の候補。保存時にidを振る。 */
export type BookCandidate = Omit<Book, 'id'>;

export const FORMATS: readonly Format[] = ['paper', 'ebook', 'audiobook'];
export const STATUSES: readonly Status[] = [
  'want',
  'stacked',
  'reading',
  'finished',
  'dropped',
];
export const BOOK_SOURCES: readonly BookSource[] = [
  'openbd',
  'ndl',
  'google',
  'manual',
];

/** 読書記録。TypeScriptのRecord型と衝突しないようにReadingRecordと呼ぶ。 */
export interface ReadingRecord {
  id: string;
  bookId: string;
  format: Format;
  /** Kindle / Kobo / Audible / audiobook.jp など */
  platform?: string;
  status: Status;
  /** YYYY-MM-DD */
  startedAt?: string;
  finishedAt?: string;
  rating?: 1 | 2 | 3 | 4 | 5;
  memo?: string;
  /** オーディオブックの長さ（分） */
  totalMinutes?: number;
  tags: string[];
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
}

export interface ReadingLog {
  id: string;
  recordId: string;
  /** YYYY-MM-DD */
  date: string;
  pages?: number;
  minutes?: number;
}

export const SCHEMA_VERSION = 1;

export interface ExportFile {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  books: Book[];
  records: ReadingRecord[];
  logs: ReadingLog[];
}
