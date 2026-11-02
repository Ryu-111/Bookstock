import { useEffect, useState } from 'preact/hooks';
import type { ExportFile } from './domain/book.js';
import { Repository, openDb } from './storage/db.js';
import type { RakutenConfig } from './lookup/rakuten.js';
import {
  browserStorage,
  loadRakutenConfig,
  requestPersistence,
  saveRakutenConfig,
} from './storage/settings.js';
import type { Persistence } from './storage/settings.js';
import { DataPanel } from './ui/data.js';
import { RakutenSettings } from './ui/rakuten-settings.js';
import { RecommendPage } from './ui/recommend.js';
import { RecordPage } from './ui/record-page.js';
import type { RecordActions } from './ui/record-page.js';
import { Icon } from './ui/ios.js';
import { href, parseRoute } from './ui/route.js';
import type { Route } from './ui/route.js';
import { Search } from './ui/search.js';
import type { SaveHandler } from './ui/search.js';
import { formatLabel } from './ui/labels.js';
import { Shelf } from './ui/shelf.js';
import { StatsPage } from './ui/stats.js';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; repo: Repository; data: ExportFile };

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function navigate(route: Route) {
  window.location.hash = href(route);
}

function currentHash(): string {
  return href(parseRoute(window.location.hash));
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

const TABS = [
  ['shelf', '本棚', 'shelf'],
  ['recommend', 'おすすめ', 'recommend'],
  ['add', '登録', 'add'],
  ['stats', '統計', 'stats'],
  ['settings', '設定', 'settings'],
] as const;

export function App() {
  const route = useRoute();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [persistence, setPersistence] = useState<Persistence>();
  const [rakuten, setRakuten] = useState<RakutenConfig | null>(() =>
    loadRakutenConfig(browserStorage()),
  );
  /** 通知は出した画面でだけ表示する（atはその画面のhash）。 */
  const [notice, setNotice] = useState<{
    text: string;
    error: boolean;
    at: string;
  }>();

  useEffect(() => {
    openDb(window.indexedDB)
      .then(async (db) => {
        const repo = new Repository(db);
        void requestPersistence(navigator.storage).then(setPersistence);
        setState({ kind: 'ready', repo, data: await repo.snapshot() });
      })
      .catch((error: unknown) =>
        setState({
          kind: 'error',
          message: message(
            error,
            '保存領域を開けません（プライベートモードなど）',
          ),
        }),
      );
  }, []);

  const tabBar = (
    <nav class="tab-bar" aria-label="メイン">
      {TABS.map(([page, label, icon]) => (
        <a
          key={page}
          href={href({ page })}
          aria-current={route.page === page ? 'page' : undefined}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );

  if (state.kind !== 'ready')
    return (
      <>
        <main>
          {state.kind === 'loading' ? (
            <p>読み込み中…</p>
          ) : (
            <p role="alert">{state.message}</p>
          )}
        </main>
        {tabBar}
      </>
    );

  const { repo } = state;
  /** 操作して全体を読み直す。成功したらtrue。 */
  const run = async <T,>(
    action: () => Promise<T>,
    done?: string,
    after?: (value: T) => void,
  ): Promise<boolean> => {
    try {
      const value = await action();
      setState({ kind: 'ready', repo, data: await repo.snapshot() });
      after?.(value);
      setNotice(
        done ? { text: done, error: false, at: currentHash() } : undefined,
      );
      return true;
    } catch (error) {
      setNotice({
        text: message(error, '保存に失敗しました'),
        error: true,
        at: currentHash(),
      });
      return false;
    }
  };

  const onSave: SaveHandler = (book, record) =>
    run(
      () => repo.addRecord(book, record),
      `「${book.title}」を登録しました`,
      ({ record: saved }) => navigate({ page: 'record', id: saved.id }),
    );

  const actions: RecordActions = {
    updateRecord: (r) => run(() => repo.updateRecord(r)),
    updateBook: (b) => run(() => repo.updateBook(b), '本の情報を保存しました'),
    addLog: (id, log) => run(() => repo.addLog(id, log)),
    deleteLog: (id) => run(() => repo.deleteLog(id)),
    deleteRecord: (id) =>
      run(
        () => repo.deleteRecord(id),
        '記録を削除しました',
        () => navigate({ page: 'shelf' }),
      ),
    addRecordForBook: (bookId, record) =>
      run(
        () => repo.addRecordForBook(bookId, record),
        '記録を追加しました',
        (saved) => navigate({ page: 'record', id: saved.id }),
      ),
  };

  return (
    <>
      <main>
        {notice && notice.at === href(route) && (
          <p role={notice.error ? 'alert' : 'status'} class="notice">
            {notice.text}
          </p>
        )}
        {route.page === 'shelf' && (
          <Shelf
            data={state.data}
            onChangeFormat={(ids, format, platform, fillEstimate) =>
              run(
                () => repo.changeFormat(ids, format, platform, fillEstimate),
                `${ids.length}冊を${formatLabel[format]}に変更しました`,
              )
            }
          />
        )}
        {route.page === 'stats' && <StatsPage data={state.data} />}
        {route.page === 'recommend' && (
          <RecommendPage
            data={state.data}
            rakuten={rakuten}
            onSave={(book, record) =>
              run(
                () => repo.addRecord(book, record),
                `「${book.title}」を本棚に追加しました`,
              )
            }
          />
        )}
        {route.page === 'add' && <Search onSave={onSave} rakuten={rakuten} />}
        {route.page === 'record' && (
          <RecordPage
            key={route.id}
            id={route.id}
            data={state.data}
            actions={actions}
          />
        )}
        {route.page === 'settings' && (
          <>
            <DataPanel
              data={state.data}
              persistence={persistence}
              onImport={async (file, mode) => {
                await repo.importFile(file, mode);
                setState({ kind: 'ready', repo, data: await repo.snapshot() });
              }}
            />
            <RakutenSettings
              config={rakuten}
              onChange={(config) => {
                const ok = saveRakutenConfig(browserStorage(), config);
                if (ok) setRakuten(config);
                return ok;
              }}
            />
          </>
        )}
      </main>
      {tabBar}
    </>
  );
}
