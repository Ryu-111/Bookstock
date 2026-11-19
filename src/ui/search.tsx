import { useMemo, useState } from 'preact/hooks';
import type { BookCandidate } from '../domain/book.js';
import { toIsbn13 } from '../domain/isbn.js';
import { emptyManualFields } from '../domain/manual.js';
import type { ManualFields } from '../domain/manual.js';
import { parseAudiblePayload } from '../lookup/audible.js';
import { lookupIsbn, searchBooks } from '../lookup/index.js';
import type { Attempt, LookupDeps, SearchField } from '../lookup/index.js';
import type { RakutenConfig } from '../lookup/rakuten.js';
import { browserXmlParser } from '../lookup/ndl.js';
import { Cover } from './cover.js';
import { Icon, Segmented } from './ios.js';
import { outcomeLabel, sourceLabel } from './labels.js';
import { ManualForm } from './manual-form.js';
import { SaveForm } from './save-form.js';
import type { SaveHandler } from './save-form.js';
import { parseRoute } from './route.js';
import { Scanner } from './scanner.js';

export type { SaveHandler } from './save-form.js';

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
        .map(
          (a) =>
            `${sourceLabel[a.source]}: ${outcomeLabel[a.outcome]}${a.detail ? `（${a.detail}）` : ''}`,
        )
        .join(' / ')}
    </p>
  );
}

/** 検索語から手入力フォームの初期値を作る。ISBNならISBN欄、著者検索なら著者欄、それ以外はタイトル欄に入れる。 */
function manualInitial(query: string, field: SearchField): ManualFields {
  const isbn = toIsbn13(query);
  if (isbn) return { ...emptyManualFields, isbn };
  return field === 'author'
    ? { ...emptyManualFields, authors: query.trim() }
    : { ...emptyManualFields, title: query.trim() };
}

/** 検索欄に貼られたBookstockの取り込みURL（`#/add?audible=`）から、取り込みのJSONを取り出す。 */
function pastedAudible(input: string): string | undefined {
  const hash = /#\/add\?.*$/s.exec(input.trim())?.[0];
  if (!hash) return undefined;
  const route = parseRoute(hash);
  return route.page === 'add' ? route.audible : undefined;
}

/** Audibleから取り込んだ本。保存フォームはオーディオブック・Audible・長さを初期値にする。 */
function AudibleImportView({
  payload,
  onSave,
}: {
  payload: string;
  onSave: SaveHandler;
}) {
  const imported = useMemo(() => parseAudiblePayload(payload), [payload]);
  if (!imported)
    return (
      <p role="alert">
        Audibleからのデータを読めませんでした。作品ページでもう一度ブックマークレットを押してください。
      </p>
    );
  const { book, totalMinutes } = imported;
  return (
    <ul class="result-list" aria-label="Audibleから取り込み">
      <li>
        <div class="result" aria-current="true">
          <Cover book={book} />
          <span class="result-text">
            <strong>{book.title}</strong>
            <span>{book.authors.join('、') || '著者不明'}</span>
            <small>
              {[
                'Audible',
                totalMinutes && `${totalMinutes}分`,
                book.publishedDate,
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          </span>
        </div>
        <SaveForm
          getBook={() => book}
          onSave={onSave}
          initialFields={{
            format: 'audiobook',
            platform: 'Audible',
            totalMinutes: totalMinutes ? String(totalMinutes) : '',
          }}
        />
      </li>
    </ul>
  );
}

const FIELDS: readonly (readonly [SearchField, string])[] = [
  ['title', 'タイトル'],
  ['author', '著者'],
];

export function Search({
  onSave,
  rakuten,
  audible,
}: {
  onSave: SaveHandler;
  rakuten: RakutenConfig | null;
  /** ブックマークレットから届いたJSON（検証前） */
  audible?: string;
}) {
  const deps: LookupDeps = {
    fetch: (url, init) => window.fetch(url, init),
    parseXml: browserXmlParser,
    rakuten,
  };
  const [query, setQuery] = useState('');
  const [field, setField] = useState<SearchField>('title');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState<ManualFields>();
  const [selected, setSelected] = useState<BookCandidate>();
  const [imported, setImported] = useState(audible);

  /** ISBNとして正しければISBNで、そうでなければ選んだ対象（タイトル・著者）で検索する。 */
  async function search(input = query) {
    if (!input.trim()) return;
    setManual(undefined);
    setSelected(undefined);
    const pasted = pastedAudible(input);
    setImported(pasted);
    if (pasted) {
      setQuery('');
      setState({ kind: 'idle' });
      return;
    }
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
        setState({ kind: 'done', ...(await searchBooks(input, field, deps)) });
      }
    } catch {
      setState({ kind: 'error', message: '検索に失敗しました' });
    }
  }

  const save: SaveHandler = async (book, record) => {
    if (!(await onSave(book, record))) return false;
    setManual(undefined);
    setSelected(undefined);
    setImported(undefined);
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
            aria-label="ISBN・タイトル・著者"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={
              field === 'author' ? '著者名で検索' : 'ISBN・タイトルで検索'
            }
          />
        </label>
        <Segmented
          label="検索の対象"
          options={FIELDS}
          value={field}
          onChange={setField}
        />
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
            setImported(undefined);
            setManual(manualInitial(query, field));
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
      {imported && !manual && (
        <AudibleImportView payload={imported} onSave={save} />
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
                onClick={() => setManual(manualInitial(query, field))}
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
