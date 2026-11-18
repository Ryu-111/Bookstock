import type { BookCandidate } from '../domain/book.js';
import {
  isObject,
  normalizeDate,
  positiveInt,
  stripRole,
  text,
} from '../domain/guard.js';

/**
 * Audibleの作品をブックマークレットで取り込む。
 *
 * AudibleのカタログAPI（非公式）はCORSで www.audible.co.jp からしか読めない。
 * そのため、作品ページの上でブックマークレットがAPIを呼び、結果を
 * `#/add?audible=<JSON>` に載せてBookstockを開く（ADR-0003の追記）。
 */

/** ブックマークレットが渡すJSONの形（v1）。 */
export interface AudiblePayload {
  v: 1;
  asin: string;
  title: string;
  authors: string[];
  publisher?: string;
  date?: string;
  minutes?: number;
  cover?: string;
}

export interface AudibleImport {
  book: BookCandidate;
  totalMinutes?: number;
}

const ASIN = /^[0-9A-Z]{10}$/;
const MAX_TEXT = 500;

function shortText(value: unknown): string | undefined {
  const t = text(value);
  return t && t.length <= MAX_TEXT ? t : undefined;
}

/** 書影はAmazonの画像サーバーのhttps URLだけ受け付ける（細工したリンクで外部の画像を読ませない）。 */
function amazonImage(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname;
    const amazon =
      host === 'm.media-amazon.com' ||
      host.endsWith('.media-amazon.com') ||
      host.endsWith('.images-amazon.com') ||
      host.endsWith('.ssl-images-amazon.com');
    return url.protocol === 'https:' && amazon ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** ブックマークレットから届いたJSON文字列を検証して、本と長さにする。不正ならundefined。 */
export function parseAudiblePayload(raw: string): AudibleImport | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObject(data) || data.v !== 1) return undefined;
  const asin = text(data.asin);
  const title = shortText(data.title);
  if (!asin || !ASIN.test(asin) || !title) return undefined;
  const authors = Array.isArray(data.authors)
    ? data.authors.flatMap((a) => {
        const name = shortText(a);
        return name ? [stripRole(name)] : [];
      })
    : [];
  const book: BookCandidate = { title, authors, asin, source: 'audible' };
  const publisher = shortText(data.publisher);
  if (publisher) book.publisher = publisher;
  const publishedDate = normalizeDate(data.date);
  if (publishedDate) book.publishedDate = publishedDate;
  const coverUrl = amazonImage(data.cover);
  if (coverUrl) book.coverUrl = coverUrl;
  const minutes = positiveInt(data.minutes);
  return minutes && minutes < 100_000
    ? { book, totalMinutes: minutes }
    : { book };
}

/**
 * ブックマークレットのコード（`javascript:` から始まる）。
 * appUrl は取り込み先のBookstockのURL（例: https://example.github.io/Bookstock/）。
 * Audibleの作品ページ（URLの最後がASIN）で押すと、APIから題名・著者・長さ・書影を取り、
 * Bookstockの登録画面を開く。
 */
export function audibleBookmarklet(appUrl: string): string {
  const code = `(()=>{const A=${JSON.stringify(appUrl)};const id=location.pathname.split('/').filter(Boolean).pop()||'';if(!/(^|\\.)audible\\.co\\.jp$/.test(location.hostname)||!/^[0-9A-Z]{10}$/.test(id)){alert('Audibleの作品ページで押してください');return}fetch('https://api.audible.co.jp/1.0/catalog/products/'+id+'?response_groups=contributors,media,product_attrs').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(d=>{const p=d&&d.product;if(!p||!p.title)throw new Error('作品が見つかりません');const n=a=>(Array.isArray(a)?a:[]).map(x=>x&&x.name).filter(Boolean);const o={v:1,asin:p.asin||id,title:p.title,authors:n(p.authors),publisher:p.publisher_name,date:p.release_date,minutes:p.runtime_length_min,cover:p.product_images&&p.product_images['500']};location.href=A+'#/add?audible='+encodeURIComponent(JSON.stringify(o))}).catch(e=>alert('Bookstockに取り込めませんでした: '+e.message))})()`;
  return `javascript:${code}`;
}
