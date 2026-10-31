import { useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type {
  Book,
  ExportFile,
  NewRecord,
  ReadingRecord,
} from '../domain/book.js';
import {
  applyBookEdit,
  bookToFields,
  parseLogFields,
  parseRecordEdit,
  recordToFields,
} from '../domain/manual.js';
import type {
  ManualFields,
  NewLog,
  RecordEditFields,
} from '../domain/manual.js';
import { Cover } from './cover.js';
import { formatLabel, sourceLabel, statusLabel, todayLocal } from './labels.js';
import { BookFields } from './manual-form.js';
import { href } from './route.js';
import { SaveForm } from './save-form.js';

/** 成功したらtrueを返す操作。失敗の表示はApp側で行う。 */
export type Action<T> = (value: T) => Promise<boolean>;

export interface RecordActions {
  updateRecord: Action<ReadingRecord>;
  updateBook: Action<Book>;
  addLog: (recordId: string, log: NewLog) => Promise<boolean>;
  deleteLog: Action<string>;
  deleteRecord: Action<string>;
  addRecordForBook: (bookId: string, record: NewRecord) => Promise<boolean>;
}

function Errors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul role="alert" class="errors">
      {errors.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

function BookInfo({ book, actions }: { book: Book; actions: RecordActions }) {
  const [editing, setEditing] = useState<ManualFields>();
  const [errors, setErrors] = useState<string[]>([]);
  if (editing)
    return (
      <form
        class="card"
        aria-label="本の情報を編集"
        onSubmit={(e) => {
          e.preventDefault();
          const result = applyBookEdit(book, editing);
          setErrors(result.ok ? [] : result.errors);
          if (result.ok)
            void actions.updateBook(result.value).then((ok) => {
              if (ok) setEditing(undefined);
            });
        }}
      >
        <BookFields fields={editing} onChange={setEditing} />
        <Errors errors={errors} />
        <div class="row">
          <button type="submit">本の情報を保存</button>
          <button type="button" onClick={() => setEditing(undefined)}>
            やめる
          </button>
        </div>
      </form>
    );
  return (
    <div class="book-info">
      <Cover book={book} />
      <div>
        <h2>{book.title}</h2>
        <p>{book.authors.join('、') || '著者不明'}</p>
        <small>
          {[
            book.publisher,
            book.publishedDate,
            book.pageCount && `${book.pageCount}ページ`,
            book.isbn13 && `ISBN ${book.isbn13}`,
            `出典: ${sourceLabel[book.source]}`,
          ]
            .filter(Boolean)
            .join(' / ')}
        </small>
        <div>
          <button type="button" onClick={() => setEditing(bookToFields(book))}>
            本の情報を編集
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordForm({
  record,
  actions,
}: {
  record: ReadingRecord;
  actions: RecordActions;
}) {
  const [fields, setFields] = useState<RecordEditFields>(() =>
    recordToFields(record),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const set =
    (key: keyof RecordEditFields) =>
    (e: Event): void => {
      const t = e.currentTarget;
      if (!(
        t instanceof HTMLInputElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLTextAreaElement
      ))
        return;
      const next = { ...fields, [key]: t.value };
      if (key === 'status' && t.value === 'finished' && !next.finishedAt)
        next.finishedAt = todayLocal();
      setFields(next);
      setSaved(false);
    };

  return (
    <form
      class="card"
      aria-label="記録を編集"
      onSubmit={(e) => {
        e.preventDefault();
        const result = parseRecordEdit(fields, record);
        setErrors(result.ok ? [] : result.errors);
        if (result.ok)
          void actions.updateRecord(result.value).then((ok) => setSaved(ok));
      }}
    >
      <div class="row">
        <label class="field">
          形式
          <select value={fields.format} onChange={set('format')}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatLabel[f]}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          状態
          <select value={fields.status} onChange={set('status')}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          評価
          <select value={fields.rating} onChange={set('rating')}>
            <option value="">なし</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={String(n)}>
                {'★'.repeat(n)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="row">
        <label class="field">
          開始日
          <input
            type="date"
            value={fields.startedAt}
            onInput={set('startedAt')}
          />
        </label>
        <label class="field">
          読了日
          <input
            type="date"
            value={fields.finishedAt}
            onInput={set('finishedAt')}
          />
        </label>
      </div>
      {fields.format !== 'paper' && (
        <div class="row">
          <label class="field">
            サービス
            <input value={fields.platform} onInput={set('platform')} />
          </label>
          {fields.format === 'audiobook' && (
            <label class="field">
              長さ（分）
              <input
                inputMode="numeric"
                value={fields.totalMinutes}
                onInput={set('totalMinutes')}
              />
            </label>
          )}
        </div>
      )}
      <label class="field">
        タグ（「、」区切り）
        <input value={fields.tags} onInput={set('tags')} />
      </label>
      <label class="field">
        メモ
        <textarea rows={4} value={fields.memo} onInput={set('memo')} />
      </label>
      <Errors errors={errors} />
      <div class="row">
        <button type="submit">記録を保存</button>
        {saved && <span role="status">保存しました</span>}
      </div>
    </form>
  );
}

function Logs({
  record,
  data,
  actions,
}: {
  record: ReadingRecord;
  data: ExportFile;
  actions: RecordActions;
}) {
  const [fields, setFields] = useState({ date: todayLocal(), amount: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const logs = data.logs
    .filter((l) => l.recordId === record.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const audio = record.format === 'audiobook';
  const unit = audio ? '分' : 'ページ';
  const total = logs.reduce(
    (sum, l) => sum + ((audio ? l.minutes : l.pages) ?? 0),
    0,
  );

  return (
    <section class="card" aria-label="進捗">
      <h3>
        進捗（合計 {total}
        {unit}）
      </h3>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          const result = parseLogFields(fields, record.format);
          setErrors(result.ok ? [] : result.errors);
          if (result.ok)
            void actions.addLog(record.id, result.value).then((ok) => {
              if (ok) setFields({ ...fields, amount: '' });
            });
        }}
      >
        <input
          type="date"
          aria-label="日付"
          value={fields.date}
          onInput={(e) => setFields({ ...fields, date: e.currentTarget.value })}
        />
        <input
          inputMode="numeric"
          aria-label={audio ? '聴いた分' : '読んだページ数'}
          placeholder={unit}
          value={fields.amount}
          onInput={(e) =>
            setFields({ ...fields, amount: e.currentTarget.value })
          }
        />
        <button type="submit">追加</button>
      </form>
      <Errors errors={errors} />
      {logs.length > 0 && (
        <ul class="logs">
          {logs.map((l) => (
            <li key={l.id}>
              {l.date}: {(audio ? l.minutes : l.pages) ?? 0}
              {unit}{' '}
              <button
                type="button"
                aria-label={`${l.date}の進捗を削除`}
                onClick={() => void actions.deleteLog(l.id)}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RecordPage({
  id,
  data,
  actions,
}: {
  id: string;
  data: ExportFile;
  actions: RecordActions;
}) {
  const record = data.records.find((r) => r.id === id);
  const book = record && data.books.find((b) => b.id === record.bookId);
  const [addingFormat, setAddingFormat] = useState(false);
  if (!record || !book)
    return (
      <section>
        <h2>記録が見つかりません</h2>
        <a href={href({ page: 'shelf' })}>本棚へ戻る</a>
      </section>
    );
  const siblings = data.records.filter(
    (r) => r.bookId === book.id && r.id !== record.id,
  );

  return (
    <section>
      <BookInfo key={book.id} book={book} actions={actions} />
      <RecordForm key={record.id} record={record} actions={actions} />
      <Logs record={record} data={data} actions={actions} />
      <section class="card" aria-label="この本のほかの記録">
        <h3>この本のほかの記録</h3>
        {siblings.length > 0 && (
          <ul>
            {siblings.map((r) => (
              <li key={r.id}>
                <a href={href({ page: 'record', id: r.id })}>
                  {formatLabel[r.format]}・{statusLabel[r.status]}
                </a>
              </li>
            ))}
          </ul>
        )}
        {addingFormat ? (
          <SaveForm
            getBook={() => book}
            onSave={(_book, input) => actions.addRecordForBook(book.id, input)}
          />
        ) : (
          <button type="button" onClick={() => setAddingFormat(true)}>
            この本を別の形式で記録
          </button>
        )}
      </section>
      <div class="danger">
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`「${book.title}」のこの記録を削除しますか？`))
              void actions.deleteRecord(record.id);
          }}
        >
          この記録を削除
        </button>
      </div>
    </section>
  );
}
