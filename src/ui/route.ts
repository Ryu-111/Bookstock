export type Route =
  | { page: 'shelf' }
  | { page: 'add' }
  | { page: 'record'; id: string }
  | { page: 'stats' }
  | { page: 'settings' };

/** location.hash を画面にする。知らない形は本棚にする。 */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/add') return { page: 'add' };
  if (path === '/settings') return { page: 'settings' };
  if (path === '/stats') return { page: 'stats' };
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
      return '#/add';
    case 'settings':
      return '#/settings';
    case 'stats':
      return '#/stats';
    case 'record':
      return `#/records/${encodeURIComponent(route.id)}`;
  }
}
