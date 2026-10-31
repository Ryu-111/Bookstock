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
