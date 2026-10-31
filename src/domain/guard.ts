/** 外部入力を1項目ずつ検証するための小さな関数群。 */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 前後の空白を除いた空でない文字列。それ以外はundefined。 */
export function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** 正の整数。数字だけの文字列も受け付ける。 */
export function positiveInt(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * 出版日をYYYY / YYYY-MM / YYYY-MM-DDにそろえる。
 * 20230115、2023-01-15、2023.1、2023年1月 などを受け付ける。
 */
export function normalizeDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const compactMatch = /^(\d{4})(\d{2})(\d{2})?$/.exec(raw);
  const parts = compactMatch
    ? [compactMatch[1], compactMatch[2], compactMatch[3]]
    : /^(\d{4})(?:[-./年](\d{1,2})(?:[-./月](\d{1,2}))?)?/.exec(raw)?.slice(1);
  if (!parts?.[0]) return undefined;
  const [year, month, day] = parts;
  const m = month ? Number(month) : undefined;
  const d = day ? Number(day) : undefined;
  if (m === undefined || m < 1 || m > 12) return year;
  const mm = String(m).padStart(2, '0');
  if (d === undefined || d < 1 || d > 31) return `${year}-${mm}`;
  return `${year}-${mm}-${String(d).padStart(2, '0')}`;
}

/** httpの画像URLをhttpsにする。http(s)以外はundefined。 */
export function httpsUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** 著者表記から役割（著・訳など）を除く。 */
export function stripRole(name: string): string {
  return name
    .replace(/[／/].*$/, '')
    .replace(/[\s\u3000]+(?:著|訳|編|作|文|絵|画|監修|原作|編著|共著)$/, '')
    .trim();
}

/** 値が候補のいずれかならその値、そうでなければundefined。 */
export function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): T | undefined {
  return values.find((v) => v === value);
}
