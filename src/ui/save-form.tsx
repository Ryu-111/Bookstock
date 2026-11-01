import { useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type { BookCandidate, NewRecord, Status } from '../domain/book.js';
import { oneOf } from '../domain/guard.js';
import { parseRecordFields } from '../domain/manual.js';
import type { RecordFields } from '../domain/manual.js';
import { Cell, Group, Segmented } from './ios.js';
import { formatShortLabel, statusLabel, todayLocal } from './labels.js';

/** 保存に成功したらtrueを返す。失敗の表示は呼び出し側が行う。 */
export type SaveHandler = (
  book: BookCandidate,
  record: NewRecord,
) => Promise<boolean>;

export const formatOptions = FORMATS.map(
  (f) => [f, formatShortLabel[f]] as const,
);

/** 本に、形式・状態・日付などを付けて保存するフォーム。 */
export function SaveForm({
  getBook,
  onSave,
  submitLabel = '本棚に追加',
  initialStatus = 'reading',
}: {
  /** 保存の直前に本を返す。手入力の検証エラーは文の配列で返す。 */
  getBook: () => BookCandidate | string[];
  onSave: SaveHandler;
  submitLabel?: string;
  initialStatus?: Status;
}) {
  const [fields, setFields] = useState<RecordFields>({
    format: 'paper',
    status: initialStatus,
    platform: '',
    date: todayLocal(),
    totalMinutes: '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof RecordFields) => (e: Event) => {
    const target = e.currentTarget;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement
    )
      setFields({ ...fields, [key]: target.value });
  };
  const needsDate = fields.status === 'reading' || fields.status === 'finished';

  return (
    <form
      class="save"
      onSubmit={(e) => {
        e.preventDefault();
        const checkedBook = getBook();
        const record = parseRecordFields(fields);
        const problems = [
          ...(Array.isArray(checkedBook) ? checkedBook : []),
          ...(record.ok ? [] : record.errors),
        ];
        setErrors(problems);
        if (Array.isArray(checkedBook) || !record.ok) return;
        setSaving(true);
        void onSave(checkedBook, record.value).finally(() => setSaving(false));
      }}
    >
      <Group>
        <Cell label="形式" control={false}>
          <Segmented
            label="形式"
            options={formatOptions}
            value={oneOf(FORMATS, fields.format) ?? 'paper'}
            onChange={(format) => setFields({ ...fields, format })}
          />
        </Cell>
        <Cell label="状態">
          <select
            aria-label="状態"
            value={fields.status}
            onChange={set('status')}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
        </Cell>
        {needsDate && (
          <Cell label={fields.status === 'finished' ? '読了日' : '開始日'}>
            <input type="date" value={fields.date} onInput={set('date')} />
          </Cell>
        )}
        {fields.format !== 'paper' && (
          <Cell label="サービス">
            <input
              aria-label="サービス"
              placeholder={
                fields.format === 'audiobook' ? 'Audibleなど' : 'Kindleなど'
              }
              value={fields.platform}
              onInput={set('platform')}
            />
          </Cell>
        )}
        {fields.format === 'audiobook' && (
          <Cell label="長さ（分）">
            <input
              inputMode="numeric"
              placeholder="任意"
              value={fields.totalMinutes}
              onInput={set('totalMinutes')}
            />
          </Cell>
        )}
      </Group>
      {errors.length > 0 && (
        <ul role="alert" class="errors">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <button type="submit" class="button-filled" disabled={saving}>
        {submitLabel}
      </button>
    </form>
  );
}
