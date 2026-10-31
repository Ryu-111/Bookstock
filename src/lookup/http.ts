export type FetchFailure = 'timeout' | 'network' | 'http' | 'quota';

export type FetchResult =
  | { ok: true; status: number; text: string }
  | { ok: false; reason: FetchFailure; status?: number };

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export const DEFAULT_TIMEOUT_MS = 5000;

/** タイムアウト付きでテキストを取得する。失敗は例外にせず理由を返す。 */
export async function fetchText(
  url: string,
  fetch: FetchLike,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchResult> {
  // AbortSignal.timeoutはNodeでタイマーがunrefされるため、自前のタイマーを使う。
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal });
    if (response.status === 429)
      return { ok: false, reason: 'quota', status: 429 };
    if (!response.ok)
      return { ok: false, reason: 'http', status: response.status };
    return { ok: true, status: response.status, text: await response.text() };
  } catch {
    if (signal.aborted) return { ok: false, reason: 'timeout' };
    // ブラウザではCORS拒否もTypeErrorになり、ここに来る。
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
