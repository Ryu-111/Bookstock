import { useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type { ExportFile } from '../domain/book.js';
import { allTags, filterRecords } from '../domain/shelf.js';
import type { ShelfFilter } from '../domain/shelf.js';
import { Cover } from './cover.js';
import { Icon, Segmented } from './ios.js';
import { formatShortLabel, statusLabel } from './labels.js';
import { href } from './route.js';

/** 横にスクロールする絞り込みのチップ。もう一度押すと外れる。 */
function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <div class="chip-group" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v === value ? undefined : v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

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
        <h1 class="large-title">本棚</h1>
        <div class="empty">
          <p>まだ本がありません</p>
          <a class="button-filled" href={href({ page: 'add' })}>
            本を登録する
          </a>
        </div>
      </section>
    );

  return (
    <section>
      <h1 class="large-title">本棚</h1>
      <label class="search-field">
        <Icon name="search" />
        <input
          type="search"
          aria-label="タイトル・著者で絞り込む"
          placeholder="タイトル・著者"
          value={filter.text ?? ''}
          onInput={(e) => choose('text', e.currentTarget.value || undefined)}
        />
      </label>
      <div class="chips">
        <Chips
          label="形式で絞り込む"
          options={FORMATS.map((f) => [f, formatShortLabel[f]] as const)}
          value={filter.format}
          onChange={(v) => choose('format', v)}
        />
        <Chips
          label="状態で絞り込む"
          options={STATUSES.map((s) => [s, statusLabel[s]] as const)}
          value={filter.status}
          onChange={(v) => choose('status', v)}
        />
      </div>
      {tags.length > 0 && (
        <div class="chips">
          <Chips
            label="タグで絞り込む"
            options={tags.map((t) => [t, `#${t}`] as const)}
            value={filter.tag}
            onChange={(v) => choose('tag', v)}
          />
        </div>
      )}
      <div class="shelf-bar">
        <p class="footnote" aria-live="polite">
          {items.length}冊
        </p>
        <Segmented
          label="並び順"
          options={[
            ['recent', '最近'],
            ['title', 'タイトル'],
          ]}
          value={filter.sort ?? 'recent'}
          onChange={(v) => choose('sort', v === 'recent' ? undefined : v)}
        />
      </div>
      {items.length === 0 ? (
        <div class="empty">
          <p>条件に合う本がありません</p>
        </div>
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
                  {statusLabel[record.status]}
                  {record.format !== 'paper' &&
                    ` · ${formatShortLabel[record.format]}`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
