import { useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type { BookCandidate, NewRecord } from '../domain/book.js';
import { parseRecordFields } from '../domain/manual.js';
import type { RecordFields } from '../domain/manual.js';
import { formatLabel, statusLabel, todayLocal } from './labels.js';

/** 保存に成功したらtrueを返す。失敗の表示は呼び出し側が行う。 */
export type SaveHandler = (
  book: BookCandidate,
  record: NewRecord,
) => Promise<boolean>;

/** 本に、形式・状態・日付などを付けて保存するフォーム。 */
export function SaveForm({
  getBook,
  onSave,
}: {
  /** 保存の直前に本を返す。手入力の検証エラーは文の配列で返す。 */
  getBook: () => BookCandidate | string[];
  onSave: SaveHandler;
}) {
  const [fields, setFields] = useState<RecordFields>({
    format: 'paper',
    status: 'reading',
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
      <select aria-label="形式" value={fields.format} onChange={set('format')}>
        {FORMATS.map((f) => (
          <option key={f} value={f}>
            {formatLabel[f]}
          </option>
        ))}
      </select>
      <select aria-label="状態" value={fields.status} onChange={set('status')}>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {statusLabel[s]}
          </option>
        ))}
      </select>
      {needsDate && (
        <label>
          {fields.status === 'finished' ? '読了日' : '開始日'}
          <input type="date" value={fields.date} onInput={set('date')} />
        </label>
      )}
      {fields.format !== 'paper' && (
        <input
          aria-label="サービス"
          placeholder={
            fields.format === 'audiobook' ? 'Audibleなど' : 'Kindleなど'
          }
          value={fields.platform}
          onInput={set('platform')}
        />
      )}
      {fields.format === 'audiobook' && (
        <label>
          長さ（分）
          <input
            inputMode="numeric"
            value={fields.totalMinutes}
            onInput={set('totalMinutes')}
          />
        </label>
      )}
      <button type="submit" disabled={saving}>
        保存
      </button>
      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
