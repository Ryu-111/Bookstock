import { useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type { BookCandidate, Format, Status } from '../domain/book.js';
import { oneOf } from '../domain/guard.js';
import { lookupIsbn, searchTitle } from '../lookup/index.js';
import type { Attempt, LookupDeps } from '../lookup/index.js';
import { browserXmlParser } from '../lookup/ndl.js';
import type { NewRecord } from '../storage/db.js';
import {
  formatLabel,
  outcomeLabel,
  sourceLabel,
  statusLabel,
  todayLocal,
} from './labels.js';

const deps: LookupDeps = {
  fetch: (url, init) => window.fetch(url, init),
  parseXml: browserXmlParser,
};

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; books: BookCandidate[]; attempts: Attempt[] };

export type SaveHandler = (
  book: BookCandidate,
  record: NewRecord,
) => Promise<void>;

function SaveForm({
  book,
  onSave,
}: {
  book: BookCandidate;
  onSave: SaveHandler;
}) {
  const [format, setFormat] = useState<Format>('paper');
  const [status, setStatus] = useState<Status>('reading');
  const [platform, setPlatform] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <form
      class="save"
      onSubmit={(e) => {
        e.preventDefault();
        const record: NewRecord = { format, status };
        const today = todayLocal();
        if (status === 'reading' || status === 'finished')
          record.startedAt = today;
        if (status === 'finished') record.finishedAt = today;
        if (format !== 'paper' && platform.trim())
          record.platform = platform.trim();
        setSaving(true);
        void onSave(book, record).finally(() => setSaving(false));
      }}
    >
      <select
        aria-label="形式"
        value={format}
        onChange={(e) => {
          const next = oneOf(FORMATS, e.currentTarget.value);
          if (next) setFormat(next);
        }}
      >
        {FORMATS.map((f) => (
          <option key={f} value={f}>
            {formatLabel[f]}
          </option>
        ))}
      </select>
      <select
        aria-label="状態"
        value={status}
        onChange={(e) => {
          const next = oneOf(STATUSES, e.currentTarget.value);
          if (next) setStatus(next);
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {statusLabel[s]}
          </option>
        ))}
      </select>
      {format !== 'paper' && (
        <input
          aria-label="サービス"
          placeholder={format === 'audiobook' ? 'Audibleなど' : 'Kindleなど'}
          value={platform}
          onInput={(e) => setPlatform(e.currentTarget.value)}
        />
      )}
      <button type="submit" disabled={saving}>
        保存
      </button>
    </form>
  );
}

function BookCard({
  book,
  onSave,
}: {
  book: BookCandidate;
  onSave: SaveHandler;
}) {
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
        <SaveForm book={book} onSave={onSave} />
      </div>
    </li>
  );
}

export function Search({ onSave }: { onSave: SaveHandler }) {
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
    <section>
      <h2>本を探す</h2>
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
        <>
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
                <BookCard key={b.isbn13 ?? b.title} book={b} onSave={onSave} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
