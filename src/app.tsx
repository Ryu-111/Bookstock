import { useEffect, useState } from 'preact/hooks';
import type { ExportFile } from './domain/book.js';
import { Repository, openDb } from './storage/db.js';
import { DataPanel } from './ui/data.js';
import { Library } from './ui/library.js';
import { Search } from './ui/search.js';
import type { SaveHandler } from './ui/search.js';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; repo: Repository; data: ExportFile };

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    openDb(window.indexedDB)
      .then(async (db) => {
        const repo = new Repository(db);
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

  if (state.kind === 'loading') return <p>読み込み中…</p>;
  if (state.kind === 'error')
    return (
      <main>
        <h1>Bookstock</h1>
        <p role="alert">{state.message}</p>
      </main>
    );

  const { repo } = state;
  const refresh = async () =>
    setState({ kind: 'ready', repo, data: await repo.snapshot() });
  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      await refresh();
      setNotice(done);
    } catch (error) {
      setNotice(message(error, '保存に失敗しました'));
    }
  };
  const onSave: SaveHandler = (book, record) =>
    run(() => repo.addRecord(book, record), `「${book.title}」を保存しました`);

  return (
    <main>
      <h1>Bookstock</h1>
      {notice && <p role="status">{notice}</p>}
      <Search onSave={onSave} />
      <Library
        data={state.data}
        onDelete={(id) =>
          run(() => repo.deleteRecord(id), '記録を削除しました')
        }
      />
      <DataPanel
        data={state.data}
        onImport={(file, mode) => repo.importFile(file, mode).then(refresh)}
      />
    </main>
  );
}
