import { useState } from 'preact/hooks';
import type { BookCandidate } from '../domain/book.js';
import { toIsbn13 } from '../domain/isbn.js';
import { emptyManualFields } from '../domain/manual.js';
import type { ManualFields } from '../domain/manual.js';
import { lookupIsbn, searchTitle } from '../lookup/index.js';
import type { Attempt, LookupDeps } from '../lookup/index.js';
import { browserXmlParser } from '../lookup/ndl.js';
import { Cover } from './cover.js';
import { Icon } from './ios.js';
import { outcomeLabel, sourceLabel } from './labels.js';
import { ManualForm } from './manual-form.js';
import { SaveForm } from './save-form.js';
import type { SaveHandler } from './save-form.js';
import { Scanner } from './scanner.js';

export type { SaveHandler } from './save-form.js';

const deps: LookupDeps = {
  fetch: (url, init) => window.fetch(url, init),
  parseXml: browserXmlParser,
};

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; books: BookCandidate[]; attempts: Attempt[] };

function bookMeta(book: BookCandidate): string {
  return [
    book.publisher,
    book.publishedDate,
    book.pageCount && `${book.pageCount}ページ`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Attempts({ attempts }: { attempts: Attempt[] }) {
  return (
    <p class="footnote" aria-label="APIごとの結果">
      {attempts
        .map((a) => `${sourceLabel[a.source]}: ${outcomeLabel[a.outcome]}`)
        .join(' / ')}
    </p>
  );
}

/** 検索語から手入力フォームの初期値を作る。ISBNならISBN欄、それ以外はタイトル欄に入れる。 */
function manualInitial(query: string): ManualFields {
  const isbn = toIsbn13(query);
  return isbn
    ? { ...emptyManualFields, isbn }
    : { ...emptyManualFields, title: query.trim() };
}

export function Search({ onSave }: { onSave: SaveHandler }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState<ManualFields>();
  const [selected, setSelected] = useState<BookCandidate>();

  /** ISBNとして正しければISBNで、そうでなければタイトルで検索する。 */
  async function search(input = query) {
    if (!input.trim()) return;
    setManual(undefined);
    setSelected(undefined);
    setState({ kind: 'loading' });
    try {
      if (toIsbn13(input)) {
        const result = await lookupIsbn(input, deps);
        if (!result.ok) {
          setState({ kind: 'error', message: 'ISBNとして正しくありません' });
          return;
        }
        setState({
          kind: 'done',
          books: result.book ? [result.book] : [],
          attempts: result.attempts,
        });
        if (result.book) setSelected(result.book);
      } else {
        setState({ kind: 'done', ...(await searchTitle(input, deps)) });
      }
    } catch {
      setState({ kind: 'error', message: '検索に失敗しました' });
    }
  }

  const save: SaveHandler = async (book, record) => {
    if (!(await onSave(book, record))) return false;
    setManual(undefined);
    setSelected(undefined);
    setState({ kind: 'idle' });
    setQuery('');
    return true;
  };

  return (
    <section>
      <h1 class="large-title">登録</h1>
      <form
        class="search-row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label class="search-field">
          <Icon name="search" />
          <input
            type="search"
            enterKeyHint="search"
            aria-label="ISBNまたはタイトル"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="ISBN・タイトルで検索"
          />
        </label>
      </form>
      <div class="action-row">
        <button
          type="button"
          class="button-tinted"
          onClick={() => setScanning(true)}
          disabled={scanning}
        >
          <Icon name="barcode" />
          スキャン
        </button>
        <button
          type="button"
          class="button-tinted"
          onClick={() => {
            setSelected(undefined);
            setManual(manualInitial(query));
          }}
        >
          手入力
        </button>
      </div>
      {scanning && (
        <Scanner
          onIsbn={(isbn) => {
            setQuery(isbn);
            void search(isbn);
          }}
          onClose={() => setScanning(false)}
        />
      )}
      {state.kind === 'idle' && !manual && !scanning && (
        <p class="footnote">
          バーコードをスキャンするか、ISBN・タイトルで検索します。見つからない本や、ISBNのない電子書籍・オーディオブックは手入力で登録できます。
        </p>
      )}
      {state.kind === 'loading' && (
        <p class="footnote" role="status">
          検索中…
        </p>
      )}
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
      {state.kind === 'done' && !manual && (
        <>
          {state.books.length === 0 ? (
            <div class="empty">
              <p>見つかりませんでした</p>
              <button
                type="button"
                class="button-plain"
                onClick={() => setManual(manualInitial(query))}
              >
                手入力で登録する
              </button>
            </div>
          ) : (
            <ul class="result-list">
              {state.books.map((b) => (
                <li key={b.isbn13 ?? `${b.title}|${b.authors.join()}`}>
                  <button
                    type="button"
                    class="result"
                    aria-pressed={selected === b}
                    onClick={() => setSelected(selected === b ? undefined : b)}
                  >
                    <Cover book={b} />
                    <span class="result-text">
                      <strong>{b.title}</strong>
                      <span>{b.authors.join('、') || '著者不明'}</span>
                      <small>{bookMeta(b)}</small>
                    </span>
                  </button>
                  {selected === b && (
                    <SaveForm getBook={() => b} onSave={save} />
                  )}
                </li>
              ))}
            </ul>
          )}
          <Attempts attempts={state.attempts} />
        </>
      )}
      {manual && (
        <ManualForm
          key={JSON.stringify(manual)}
          initial={manual}
          onSave={save}
        />
      )}
    </section>
  );
}
