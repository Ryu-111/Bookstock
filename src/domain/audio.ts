/**
 * オーディオブックの長さの推定。文字数はどの書誌APIからも取れないため、ページ数で代用する。
 *
 * - 日本語の本は1ページ約500字（文庫は約600字、単行本は約560字。余白・改行を見込んだ実効値）
 * - 朗読は1分あたり約300字
 *
 * よって1ページ ≒ 500 / 300 ≒ 1.7分。300ページの本は約8.5時間で、
 * 一般的な小説のオーディオブック（8〜10時間）と同じくらいになる。
 */
export const MINUTES_PER_PAGE = 1.7;

/** ページ数から推定した長さ（分）。ページ数がなければundefined。 */
export function estimateMinutes(
  pageCount: number | undefined,
): number | undefined {
  if (!pageCount || pageCount <= 0) return undefined;
  return Math.round(pageCount * MINUTES_PER_PAGE);
}
