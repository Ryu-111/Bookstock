import { useEffect, useState } from 'preact/hooks';
import { isObject, text } from '../domain/guard.js';
import { fetchText } from '../lookup/http.js';
import type { FetchLike } from '../lookup/http.js';

/** version.json の中身を検証して、版の印を返す。読めなければnull。 */
export function parseVersion(body: string): string | null {
  try {
    const value: unknown = JSON.parse(body);
    return isObject(value) ? (text(value.id) ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * 公開中の版が、いま動いている版と違うか。
 * 通信できない・読めないときは false（知らせない）。
 */
export async function hasUpdate(
  url: string,
  current: string,
  fetch: FetchLike,
): Promise<boolean> {
  const result = await fetchText(url, fetch);
  if (!result.ok) return false;
  const published = parseVersion(result.text);
  return published !== null && published !== current;
}

/** 開いたままでも気づけるよう、この間隔でも確かめる。 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** 新しい版が公開されたらtrue。起動時、画面に戻ったとき、30分ごとに確かめる。 */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    // 開発サーバーには version.json がない
    if (import.meta.env.DEV || available) return;
    let cancelled = false;
    const url = `${import.meta.env.BASE_URL}version.json`;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void hasUpdate(url, __BUILD_ID__, (u, init) =>
        // 古い version.json を掴まないよう、キャッシュを使わない
        window.fetch(u, { ...init, cache: 'no-store' }),
      ).then((found) => {
        if (found && !cancelled) setAvailable(true);
      });
    };
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [available]);
  return available;
}
