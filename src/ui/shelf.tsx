import { useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type { ExportFile } from '../domain/book.js';
import { oneOf } from '../domain/guard.js';
import { allTags, filterRecords } from '../domain/shelf.js';
import type { ShelfFilter } from '../domain/shelf.js';
import { Cover } from './cover.js';
import { formatLabel, statusLabel } from './labels.js';
import { href } from './route.js';

export function Shelf({ data }: { data: ExportFile }) {
  const [filter, setFilter] = useState<ShelfFilter>({});
  /** 1つの条件を差し替える。undefinedなら条件を外す。 */
  const choose = <K extends keyof ShelfFilter>(
    key: K,
    value: ShelfFilter[K] | undefined,
  ) => {
    const next = { ...filter };
    if (value === undefined) delete next[key];
    else next[key] = value;
    setFilter(next);
  };
  const items = filterRecords(data, filter);
  const tags = allTags(data);

  if (data.records.length === 0)
    return (
      <section>
        <h2>本棚</h2>
        <p>
          まだ記録がありません。<a href={href({ page: 'add' })}>本を登録する</a>
        </p>
      </section>
    );

  return (
    <section>
      <h2>本棚（{items.length}件）</h2>
      <div class="filters">
        <input
          type="search"
          aria-label="タイトル・著者で絞り込む"
          placeholder="タイトル・著者"
          value={filter.text ?? ''}
          onInput={(e) => choose('text', e.currentTarget.value || undefined)}
        />
        <select
          aria-label="形式で絞り込む"
          value={filter.format ?? ''}
          onChange={(e) =>
            choose('format', oneOf(FORMATS, e.currentTarget.value))
          }
        >
          <option value="">すべての形式</option>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {formatLabel[f]}
            </option>
          ))}
        </select>
        <select
          aria-label="状態で絞り込む"
          value={filter.status ?? ''}
          onChange={(e) =>
            choose('status', oneOf(STATUSES, e.currentTarget.value))
          }
        >
          <option value="">すべての状態</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
        {tags.length > 0 && (
          <select
            aria-label="タグで絞り込む"
            value={filter.tag ?? ''}
            onChange={(e) => choose('tag', oneOf(tags, e.currentTarget.value))}
          >
            <option value="">すべてのタグ</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      {items.length === 0 ? (
        <p>条件に合う記録がありません。</p>
      ) : (
        <ul class="shelf">
          {items.map(({ record, book }) => (
            <li key={record.id}>
              <a
                href={href({ page: 'record', id: record.id })}
                class="shelf-item"
              >
                <Cover book={book} />
                <span class="shelf-title">{book.title}</span>
                <span class={`badge status-${record.status}`}>
                  {formatLabel[record.format]}・{statusLabel[record.status]}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
