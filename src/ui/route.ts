export type Route =
  | { page: 'shelf' }
  /** audible はブックマークレットから届いたJSON（検証前の外部入力） */
  | { page: 'add'; audible?: string }
  | { page: 'record'; id: string }
  | { page: 'stats' }
  | { page: 'recommend' }
  | { page: 'settings' };

/** location.hash を画面にする。知らない形は本棚にする。 */
export function parseRoute(hash: string): Route {
  const [path = '/', query = ''] = (hash.replace(/^#/, '') || '/').split(
    /\?(.*)/s,
  );
  if (path === '/add') {
    const audible = new URLSearchParams(query).get('audible');
    return audible ? { page: 'add', audible } : { page: 'add' };
  }
  if (path === '/settings') return { page: 'settings' };
  if (path === '/stats') return { page: 'stats' };
  if (path === '/recommend') return { page: 'recommend' };
  const match = /^\/records\/([^/]+)$/.exec(path);
  if (match?.[1]) {
    try {
      const id = decodeURIComponent(match[1]);
      if (id.trim()) return { page: 'record', id };
    } catch {
      // 不正なURLエンコードは本棚へ
    }
  }
  return { page: 'shelf' };
}

export function href(route: Route): string {
  switch (route.page) {
    case 'shelf':
      return '#/';
    case 'add':
      return route.audible
        ? `#/add?${new URLSearchParams({ audible: route.audible }).toString()}`
        : '#/add';
    case 'settings':
      return '#/settings';
    case 'stats':
      return '#/stats';
    case 'recommend':
      return '#/recommend';
    case 'record':
      return `#/records/${encodeURIComponent(route.id)}`;
  }
}
