import { useState } from 'preact/hooks';
import type { BookCandidate } from '../domain/book.js';
import { toIsbn13 } from '../domain/isbn.js';
import { emptyManualFields } from '../domain/manual.js';
import type { ManualFields } from '../domain/manual.js';
import { lookupIsbn, searchTitle } from '../lookup/index.js';
import type { Attempt, LookupDeps } from '../lookup/index.js';
import { browserXmlParser } from '../lookup/ndl.js';
import { Cover } from './cover.js';
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

function BookCard({
  book,
  onSave,
}: {
  book: BookCandidate;
  onSave: SaveHandler;
}) {
  return (
    <li class="book">
      <Cover book={book} />
      <div>
        <strong>{book.title}</strong>
        <div>{book.authors.join('、') || '著者不明'}</div>
        <small>
          {[
            book.publisher,
            book.publishedDate,
            book.pageCount && `${book.pageCount}ページ`,
            book.isbn13 && `ISBN ${book.isbn13}`,
            book.ndc && `NDC ${book.ndc}`,
            `出典: ${sourceLabel[book.source]}`,
          ]
            .filter(Boolean)
            .join(' / ')}
        </small>
        <SaveForm getBook={() => book} onSave={onSave} />
      </div>
    </li>
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

  async function search(mode: 'isbn' | 'title', input = query) {
    setManual(undefined);
    setState({ kind: 'loading' });
    try {
      if (mode === 'isbn') {
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
    setState({ kind: 'idle' });
    setQuery('');
    return true;
  };

  return (
    <section>
      <h2>本を登録する</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search('isbn');
        }}
      >
        <input
          aria-label="ISBNまたはタイトル"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="ISBN（978…）またはタイトル"
        />
        <button type="submit" disabled={state.kind === 'loading'}>
          ISBNで検索
        </button>
        <button
          type="button"
          disabled={state.kind === 'loading'}
          onClick={() => void search('title')}
        >
          タイトルで検索
        </button>
        <button
          type="button"
          onClick={() => setScanning(true)}
          disabled={scanning}
        >
          バーコードを読み取る
        </button>
        <button type="button" onClick={() => setManual(manualInitial(query))}>
          手入力
        </button>
      </form>
      {scanning && (
        <Scanner
          onIsbn={(isbn) => {
            setQuery(isbn);
            void search('isbn', isbn);
          }}
          onClose={() => setScanning(false)}
        />
      )}
      {state.kind === 'loading' && <p>検索中…</p>}
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
      {state.kind === 'done' && (
        <>
          <ul aria-label="APIごとの結果">
            {state.attempts.map((a) => (
              <li key={a.source}>
                {sourceLabel[a.source]}: {outcomeLabel[a.outcome]}
              </li>
            ))}
          </ul>
          {state.books.length === 0 ? (
            <p>
              見つかりませんでした。{' '}
              <button
                type="button"
                onClick={() => setManual(manualInitial(query))}
              >
                手入力で登録する
              </button>
            </p>
          ) : (
            <ul class="books">
              {state.books.map((b) => (
                <BookCard key={b.isbn13 ?? b.title} book={b} onSave={save} />
              ))}
            </ul>
          )}
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
