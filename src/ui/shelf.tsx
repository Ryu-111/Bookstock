import { useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type { ExportFile, Format } from '../domain/book.js';
import { allTags, filterRecords } from '../domain/shelf.js';
import type { ShelfFilter } from '../domain/shelf.js';
import { Cover } from './cover.js';
import { Cell, Group, Icon, Segmented } from './ios.js';
import { formatLabel, formatShortLabel, statusLabel } from './labels.js';
import { formatOptions } from './save-form.js';
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

/** 形式の一括変更。成功したらtrue。 */
export type ChangeFormat = (
  ids: string[],
  format: Format,
  platform: string | undefined,
  fillEstimate: boolean,
) => Promise<boolean>;

/** 下から出るシート。選んだ記録の形式をまとめて変える。 */
function FormatSheet({
  count,
  onApply,
  onClose,
}: {
  count: number;
  onApply: (
    format: Format,
    platform: string | undefined,
    fillEstimate: boolean,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<Format>('audiobook');
  const [platform, setPlatform] = useState('');
  const [fillEstimate, setFillEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div
      class="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="形式を変更"
      onClick={onClose}
    >
      <form
        class="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !window.confirm(
              `${count}冊の形式を「${formatLabel[format]}」に変更しますか？`,
            )
          )
            return;
          setBusy(true);
          void onApply(
            format,
            platform.trim() || undefined,
            format === 'audiobook' && fillEstimate,
          ).finally(() => setBusy(false));
        }}
      >
        <div class="sheet-head">
          <button type="button" class="button-plain" onClick={onClose}>
            キャンセル
          </button>
          <strong>{count}冊の形式を変更</strong>
          <span class="sheet-spacer" />
        </div>
        <Group
          footer={
            format === 'paper'
              ? '紙にすると、サービス名と長さ（分）は外れます。'
              : 'サービス名を空にすると、それぞれの今の値を残します。'
          }
        >
          <Cell label="形式" control={false}>
            <Segmented
              label="形式"
              options={formatOptions}
              value={format}
              onChange={setFormat}
            />
          </Cell>
          {format !== 'paper' && (
            <Cell label="サービス">
              <input
                aria-label="サービス"
                placeholder={
                  format === 'audiobook'
                    ? 'Audibleなど（任意）'
                    : 'Kindleなど（任意）'
                }
                value={platform}
                onInput={(e) => setPlatform(e.currentTarget.value)}
              />
            </Cell>
          )}
          {format === 'audiobook' && (
            <label class="cell">
              <span class="cell-label cell-grow">
                長さが空の本に推定値を入れる
              </span>
              <input
                type="checkbox"
                class="switch"
                checked={fillEstimate}
                onChange={(e) => setFillEstimate(e.currentTarget.checked)}
              />
            </label>
          )}
        </Group>
        <button type="submit" class="button-filled" disabled={busy}>
          {count}冊に適用
        </button>
      </form>
    </div>
  );
}

export function Shelf({
  data,
  onChangeFormat,
}: {
  data: ExportFile;
  onChangeFormat: ChangeFormat;
}) {
  const [filter, setFilter] = useState<ShelfFilter>({});
  /** 選択モードなら選んだ記録のid。nullなら通常モード。 */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [sheet, setSheet] = useState(false);
  const toggle = (id: string) => {
    if (!selected) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
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

  const selecting = selected !== null;
  return (
    <section>
      <div class="title-row">
        <h1 class="large-title">本棚</h1>
        {selecting ? (
          <div class="title-actions">
            <button
              type="button"
              class="button-plain"
              onClick={() =>
                setSelected(
                  selected.size === items.length
                    ? new Set()
                    : new Set(items.map((i) => i.record.id)),
                )
              }
            >
              {selected.size === items.length && items.length > 0
                ? '選択を解除'
                : 'すべて選択'}
            </button>
            <button
              type="button"
              class="button-plain strong"
              onClick={() => setSelected(null)}
            >
              完了
            </button>
          </div>
        ) : (
          <button
            type="button"
            class="button-plain"
            onClick={() => setSelected(new Set())}
          >
            選択
          </button>
        )}
      </div>
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
        <ul class={selecting ? 'shelf selecting' : 'shelf'}>
          {items.map(({ record, book }) => (
            <li key={record.id}>
              <a
                href={href({ page: 'record', id: record.id })}
                class="shelf-item"
                aria-pressed={selecting ? selected.has(record.id) : undefined}
                onClick={(e) => {
                  if (!selecting) return;
                  e.preventDefault();
                  toggle(record.id);
                }}
              >
                <span class="cover-wrap">
                  <Cover book={book} />
                  {selecting && (
                    <span
                      class={selected.has(record.id) ? 'check on' : 'check'}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  )}
                </span>
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
      {selecting && (
        <div class="select-bar" role="toolbar" aria-label="選択した本の操作">
          <span>{selected.size}冊を選択中</span>
          <button
            type="button"
            class="button-plain strong"
            disabled={selected.size === 0}
            onClick={() => setSheet(true)}
          >
            形式を変更
          </button>
        </div>
      )}
      {selecting && sheet && (
        <FormatSheet
          count={selected.size}
          onClose={() => setSheet(false)}
          onApply={async (format, platform, fillEstimate) => {
            const ok = await onChangeFormat(
              [...selected],
              format,
              platform,
              fillEstimate,
            );
            if (ok) {
              setSheet(false);
              setSelected(null);
            }
            return ok;
          }}
        />
      )}
    </section>
  );
}
