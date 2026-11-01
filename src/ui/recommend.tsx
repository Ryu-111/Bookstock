import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BookCandidate, ExportFile } from '../domain/book.js';
import { ownedIndex } from '../domain/recommend.js';
import {
  createThrottle,
  recommendByAuthors,
  recommendRanking,
  recommendSeries,
} from '../lookup/recommend.js';
import type { AuthorPick, RecommendDeps } from '../lookup/recommend.js';
import type { RakutenConfig, RakutenGenre } from '../lookup/rakuten.js';
import { Cover } from './cover.js';
import { outcomeLabel } from './labels.js';
import { href } from './route.js';
import { SaveForm } from './save-form.js';
import type { SaveHandler } from './save-form.js';

/** 本（全体）のジャンルID。楽天ブックスの最上位。 */
const ROOT_GENRE = '001';

// 楽天の制限（1アプリIDにつき1秒1回）に合わせ、画面をまたいで共有する。
const throttle = createThrottle(1100);
const cache = new Map<string, string>();

function Row({
  books,
  onPick,
}: {
  books: BookCandidate[];
  onPick: (book: BookCandidate) => void;
}) {
  return (
    <ul class="rec-row">
      {books.map((b) => (
        <li key={b.isbn13 ?? b.title}>
          <button type="button" class="rec-item" onClick={() => onPick(b)}>
            <Cover book={b} />
            <span class="shelf-title">{b.title}</span>
            <span class="badge">
              {[b.authors[0], b.publishedDate?.slice(0, 7)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ComponentChildren;
}) {
  return (
    <section class="rec-section" aria-label={title}>
      <h2 class="rec-title">{title}</h2>
      {note && <p class="footnote">{note}</p>}
      {children}
    </section>
  );
}

/** 選んだ本の詳細と、本棚に追加するフォーム（下から出るシート）。 */
function BookSheet({
  book,
  onSave,
  onClose,
}: {
  book: BookCandidate;
  onSave: SaveHandler;
  onClose: () => void;
}) {
  return (
    <div
      class="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={book.title}
      onClick={onClose}
    >
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-head">
          <button type="button" class="button-plain" onClick={onClose}>
            閉じる
          </button>
          <span />
          <span class="sheet-spacer" />
        </div>
        <div class="book-hero">
          <Cover book={book} />
          <h1>{book.title}</h1>
          <p class="secondary">{book.authors.join('、') || '著者不明'}</p>
          <p class="footnote">
            {[book.publisher, book.publishedDate].filter(Boolean).join(' · ')}
          </p>
        </div>
        <SaveForm
          getBook={() => book}
          initialStatus="want"
          onSave={async (b, record) => {
            const ok = await onSave(b, record);
            if (ok) onClose();
            return ok;
          }}
        />
      </div>
    </div>
  );
}

type Failure = keyof typeof outcomeLabel | null;

export function RecommendPage({
  data,
  rakuten,
  onSave,
}: {
  data: ExportFile;
  rakuten: RakutenConfig | null;
  onSave: SaveHandler;
}) {
  const [series, setSeries] = useState<BookCandidate[]>([]);
  const [authors, setAuthors] = useState<AuthorPick[]>([]);
  const [ranking, setRanking] = useState<BookCandidate[]>([]);
  const [genres, setGenres] = useState<RakutenGenre[]>([]);
  const [genre, setGenre] = useState(ROOT_GENRE);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<Failure>(null);
  const [picked, setPicked] = useState<BookCandidate>();
  // 保存のたびに data が変わっても、おすすめは開いたときの本棚で作る
  const snapshot = useRef(data);

  const deps: RecommendDeps | null = rakuten
    ? {
        fetch: (url, init) => window.fetch(url, init),
        rakuten,
        throttle,
        cache,
      }
    : null;

  useEffect(() => {
    if (!deps) return;
    let cancelled = false;
    const d = snapshot.current;
    setLoading(true);
    void (async () => {
      const failures = [
        await recommendSeries(d, deps, (book) => {
          if (!cancelled) setSeries((prev) => [...prev, book]);
        }),
        await recommendByAuthors(d, deps, (pick) => {
          if (!cancelled) setAuthors((prev) => [...prev, pick]);
        }),
      ];
      const r = await recommendRanking(d, ROOT_GENRE, deps);
      if (cancelled) return;
      if (r.ok) {
        setRanking(r.books);
        setGenres(r.genres);
      } else if (r.reason !== 'not_found') failures.push(r.reason);
      setFailure(failures.find((f) => f !== null) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [rakuten]);

  const chooseGenre = (id: string) => {
    if (!deps || id === genre) return;
    setGenre(id);
    setRanking([]);
    void recommendRanking(snapshot.current, id, deps).then((r) => {
      if (r.ok) setRanking(r.books);
      else if (r.reason !== 'not_found') setFailure(r.reason);
    });
  };

  if (!rakuten)
    return (
      <section>
        <h1 class="large-title">おすすめ</h1>
        <div class="empty">
          <p>
            おすすめは楽天ブックスAPIで探します。設定で楽天のアプリIDを入れてください。
          </p>
          <a class="button-filled" href={href({ page: 'settings' })}>
            設定を開く
          </a>
        </div>
      </section>
    );

  // 追加した本はすぐに表示から外す
  const owned = ownedIndex(data);
  const visible = (books: BookCandidate[]) => books.filter((b) => !owned(b));

  const nothing =
    !loading &&
    series.length === 0 &&
    authors.length === 0 &&
    ranking.length === 0;

  return (
    <section>
      <h1 class="large-title">おすすめ</h1>
      <p class="footnote">
        よく読む著者名と、読んだシリーズ名を楽天ブックスに送って探します。読書記録そのものは送りません。
      </p>
      {loading && (
        <p class="footnote" role="status">
          探しています…（楽天の制限に合わせて少しずつ読み込みます）
        </p>
      )}
      {failure && (
        <p role="alert" class="footnote">
          一部を読み込めませんでした: {outcomeLabel[failure]}
        </p>
      )}

      {visible(series).length > 0 && (
        <Section title="シリーズの続き" note="読んだ巻の次の巻です">
          <Row books={visible(series)} onPick={setPicked} />
        </Section>
      )}

      {authors
        .filter((a) => visible(a.books).length > 0)
        .map((a) => (
          <Section key={a.author} title={`${a.author}の本`} note="新しい順">
            <Row books={visible(a.books)} onPick={setPicked} />
          </Section>
        ))}

      {(ranking.length > 0 || genres.length > 0) && (
        <Section title="人気の本" note="楽天ブックスで売れている順">
          {genres.length > 0 && (
            <div class="chips" role="group" aria-label="ジャンル">
              <button
                type="button"
                aria-pressed={genre === ROOT_GENRE}
                onClick={() => chooseGenre(ROOT_GENRE)}
              >
                すべて
              </button>
              {genres.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={genre === g.id}
                  onClick={() => chooseGenre(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          {ranking.length > 0 ? (
            <Row books={visible(ranking)} onPick={setPicked} />
          ) : (
            <p class="footnote">読み込み中…</p>
          )}
        </Section>
      )}

      {nothing && (
        <div class="empty">
          <p>
            おすすめが見つかりませんでした。同じ著者の本を2冊以上読むと、著者のおすすめが出ます。
          </p>
        </div>
      )}

      {picked && (
        <BookSheet
          book={picked}
          onSave={onSave}
          onClose={() => setPicked(undefined)}
        />
      )}
    </section>
  );
}
