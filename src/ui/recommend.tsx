import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BookCandidate, ExportFile } from '../domain/book.js';
import { leafGenre, ownedIndex, rankForYou } from '../domain/recommend.js';
import type { Candidate, GenreTaste, Scored } from '../domain/recommend.js';
import {
  recommendByAuthors,
  recommendGenres,
  recommendRanking,
  recommendSeries,
} from '../lookup/recommend.js';
import type {
  AuthorPick,
  GenrePick,
  RecommendDeps,
} from '../lookup/recommend.js';
import type { RakutenConfig, RakutenGenre } from '../lookup/rakuten.js';
import { Cover } from './cover.js';
import { outcomeLabel } from './labels.js';
import { rakutenCache, rakutenThrottle } from './rakuten-shared.js';
import { href } from './route.js';
import { SaveForm } from './save-form.js';
import type { SaveHandler } from './save-form.js';

/** 本（全体）のジャンルID。楽天ブックスの最上位。 */
const ROOT_GENRE = '001';

function Row({
  books,
  onPick,
  reasons,
}: {
  books: BookCandidate[];
  onPick: (book: BookCandidate) => void;
  /** 本ごとの、おすすめの理由 */
  reasons?: Map<BookCandidate, string[]>;
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
            {reasons?.get(b)?.length ? (
              <span class="rec-reason">{reasons.get(b)?.join('・')}</span>
            ) : null}
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
  const [genrePicks, setGenrePicks] = useState<GenrePick[]>([]);
  const [forYou, setForYou] = useState<Scored[]>([]);
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
        throttle: rakutenThrottle,
        cache: rakutenCache,
      }
    : null;

  useEffect(() => {
    if (!deps) return;
    let cancelled = false;
    const d = snapshot.current;
    setLoading(true);
    void (async () => {
      const candidates: Candidate[] = [];
      let tastes: GenreTaste[] = [];
      const failures = [
        await recommendSeries(d, deps, (book) => {
          if (!cancelled) setSeries((prev) => [...prev, book]);
        }),
        await recommendGenres(d, deps, (pick) => {
          candidates.push(...pick.candidates);
          if (!cancelled) setGenrePicks((prev) => [...prev, pick]);
        }).then((r) => {
          tastes = r.genres;
          return r.failure;
        }),
        await recommendByAuthors(d, deps, (pick) => {
          candidates.push(...pick.candidates);
          if (!cancelled) setAuthors((prev) => [...prev, pick]);
        }),
      ];
      const r = await recommendRanking(d, ROOT_GENRE, deps);
      if (cancelled) return;
      if (r.ok) {
        candidates.push(...r.candidates);
        setRanking(r.books);
        setGenres(r.genres);
      } else if (r.reason !== 'not_found') failures.push(r.reason);
      setForYou(rankForYou(d, candidates, tastes, new Date()));
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
          <p>楽天のアプリIDを設定すると使えます</p>
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
    genrePicks.length === 0 &&
    ranking.length === 0;
  const forYouBooks = visible(forYou.map((s) => s.book));
  const reasons = new Map(forYou.map((s) => [s.book, s.reasons]));

  return (
    <section>
      <h1 class="large-title">おすすめ</h1>
      {loading && (
        <p class="footnote" role="status">
          探しています…
        </p>
      )}
      {failure && (
        <p role="alert" class="footnote">
          一部を読み込めませんでした: {outcomeLabel[failure]}
        </p>
      )}

      {forYouBooks.length > 0 && (
        <Section title="あなたへのおすすめ">
          <Row books={forYouBooks} onPick={setPicked} reasons={reasons} />
        </Section>
      )}

      {visible(series).length > 0 && (
        <Section title="シリーズの続き">
          <Row books={visible(series)} onPick={setPicked} />
        </Section>
      )}

      {genrePicks
        .filter((g) => visible(g.books).length > 0)
        .map((g) => (
          <Section key={g.genre.id} title={`${leafGenre(g.genre.key)}の人気本`}>
            <Row books={visible(g.books)} onPick={setPicked} />
          </Section>
        ))}

      {authors
        .filter((a) => visible(a.books).length > 0)
        .map((a) => (
          <Section key={a.author} title={`${a.author}の本`}>
            <Row books={visible(a.books)} onPick={setPicked} />
          </Section>
        ))}

      {(ranking.length > 0 || genres.length > 0) && (
        <Section title="人気の本">
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
          <p>まだおすすめがありません。同じ著者の本を2冊読むと出ます</p>
        </div>
      )}

      <p class="footnote page-note">
        著者名・シリーズ名・ジャンルを楽天に送って探します
      </p>

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
