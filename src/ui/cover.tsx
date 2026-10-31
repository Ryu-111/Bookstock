import { useState } from 'preact/hooks';
import type { Book, BookCandidate } from '../domain/book.js';

/** 書影。ない・読み込めないときはタイトルの文字で代わりにする。 */
export function Cover({ book }: { book: Book | BookCandidate }) {
  const [broken, setBroken] = useState(false);
  if (book.coverUrl && !broken)
    return (
      <img
        src={book.coverUrl}
        alt=""
        loading="lazy"
        class="cover"
        onError={() => setBroken(true)}
      />
    );
  return (
    <span class="cover cover-text" aria-hidden="true">
      {book.title}
    </span>
  );
}
