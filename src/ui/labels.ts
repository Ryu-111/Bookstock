import type { BookSource, Format, Status } from '../domain/book.js';
import type { Outcome } from '../lookup/index.js';

export const formatLabel: Record<Format, string> = {
  paper: '紙の本',
  ebook: '電子書籍',
  audiobook: 'オーディオブック',
};

export const statusLabel: Record<Status, string> = {
  want: '読みたい',
  stacked: '積読',
  reading: '読書中',
  finished: '読了',
  dropped: '中断',
};

export const sourceLabel: Record<BookSource, string> = {
  openbd: 'openBD',
  ndl: 'NDLサーチ',
  google: 'Google Books',
  manual: '手入力',
};

export const outcomeLabel: Record<Outcome, string> = {
  found: '成功',
  not_found: '該当なし',
  timeout: 'タイムアウト',
  network: '通信失敗（CORS・遮断を含む）',
  http: 'HTTPエラー',
  quota: '上限',
};

export function todayLocal(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
