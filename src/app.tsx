import { useState } from 'preact/hooks';
import type { BookCandidate, BookSource } from './domain/book.js';
import { lookupIsbn, searchTitle } from './lookup/index.js';
import type { Attempt, LookupDeps, Outcome } from './lookup/index.js';
import { browserXmlParser } from './lookup/ndl.js';

const deps: LookupDeps = {
  fetch: (url, init) => window.fetch(url, init),
  parseXml: browserXmlParser,
};

const outcomeLabel: Record<Outcome, string> = {
  found: '成功',
  not_found: '該当なし',
  timeout: 'タイムアウト',
  network: '通信失敗（CORS・遮断を含む）',
  http: 'HTTPエラー',
  quota: '上限',
};

const sourceLabel: Record<BookSource, string> = {
  openbd: 'openBD',
  ndl: 'NDLサーチ',
  google: 'Google Books',
  manual: '手入力',
};

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; books: BookCandidate[]; attempts: Attempt[] };

function BookCard({ book }: { book: BookCandidate }) {
  return (
    <li class="book">
      {book.coverUrl && (
        <img
          src={book.coverUrl}
          alt=""
          width={64}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
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
      </div>
    </li>
  );
}

export function App() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function search(mode: 'isbn' | 'title') {
    setState({ kind: 'loading' });
    try {
      if (mode === 'isbn') {
        const result = await lookupIsbn(query, deps);
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
        setState({ kind: 'done', ...(await searchTitle(query, deps)) });
      }
    } catch {
      setState({ kind: 'error', message: '検索に失敗しました' });
    }
  }

  return (
    <main>
      <h1>Bookstock</h1>
      <p>書誌検索の確認（保存はまだできません）</p>
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
      </form>
      {state.kind === 'loading' && <p>検索中…</p>}
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
      {state.kind === 'done' && (
        <section>
          <ul aria-label="APIごとの結果">
            {state.attempts.map((a) => (
              <li key={a.source}>
                {sourceLabel[a.source]}: {outcomeLabel[a.outcome]}
              </li>
            ))}
          </ul>
          {state.books.length === 0 ? (
            <p>見つかりませんでした。手入力での登録はM3で追加します。</p>
          ) : (
            <ul class="books">
              {state.books.map((b) => (
                <BookCard key={b.isbn13 ?? b.title} book={b} />
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
