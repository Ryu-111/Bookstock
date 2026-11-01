import { useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type {
  Book,
  ExportFile,
  NewRecord,
  ReadingRecord,
} from '../domain/book.js';
import { oneOf } from '../domain/guard.js';
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
import { Cell, Group, Icon, Segmented, Stars } from './ios.js';
import { formatLabel, sourceLabel, statusLabel, todayLocal } from './labels.js';
import { BookFields } from './manual-form.js';
import { href } from './route.js';
import { SaveForm, formatOptions } from './save-form.js';

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
        <div class="action-row">
          <button
            type="button"
            class="button-tinted"
            onClick={() => setEditing(undefined)}
          >
            キャンセル
          </button>
          <button type="submit" class="button-filled">
            完了
          </button>
        </div>
      </form>
    );
  const meta = [
    book.publisher,
    book.publishedDate,
    book.pageCount && `${book.pageCount}ページ`,
  ].filter(Boolean);
  return (
    <header class="book-hero">
      <Cover book={book} />
      <h1>{book.title}</h1>
      <p class="secondary">{book.authors.join('、') || '著者不明'}</p>
      {meta.length > 0 && <p class="footnote">{meta.join(' · ')}</p>}
      <p class="footnote">
        {book.isbn13 && `ISBN ${book.isbn13} · `}出典:{' '}
        {sourceLabel[book.source]}
      </p>
      <button
        type="button"
        class="button-plain"
        onClick={() => setEditing(bookToFields(book))}
      >
        本の情報を編集
      </button>
    </header>
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
  const update = (patch: Partial<RecordEditFields>) => {
    const next = { ...fields, ...patch };
    if (patch.status === 'finished' && !next.finishedAt)
      next.finishedAt = todayLocal();
    setFields(next);
    setSaved(false);
  };
  const input =
    (key: keyof RecordEditFields) =>
    (e: Event): void => {
      const t = e.currentTarget;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLTextAreaElement
      )
        update({ [key]: t.value });
    };
  const format = oneOf(FORMATS, fields.format) ?? 'paper';

  return (
    <form
      aria-label="記録を編集"
      onSubmit={(e) => {
        e.preventDefault();
        const result = parseRecordEdit(fields, record);
        setErrors(result.ok ? [] : result.errors);
        if (result.ok)
          void actions.updateRecord(result.value).then((ok) => setSaved(ok));
      }}
    >
      <Group header="記録">
        <Cell label="形式" control={false}>
          <Segmented
            label="形式"
            options={formatOptions}
            value={format}
            onChange={(f) => update({ format: f })}
          />
        </Cell>
        <Cell label="状態">
          <select value={fields.status} onChange={input('status')}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
        </Cell>
        <Cell label="評価" control={false}>
          <Stars
            value={fields.rating}
            onChange={(rating) => update({ rating })}
          />
        </Cell>
        <Cell label="開始日">
          <input
            type="date"
            value={fields.startedAt}
            onInput={input('startedAt')}
          />
        </Cell>
        <Cell label="読了日">
          <input
            type="date"
            value={fields.finishedAt}
            onInput={input('finishedAt')}
          />
        </Cell>
        {format !== 'paper' && (
          <Cell label="サービス">
            <input
              placeholder={
                format === 'audiobook' ? 'Audibleなど' : 'Kindleなど'
              }
              value={fields.platform}
              onInput={input('platform')}
            />
          </Cell>
        )}
        {format === 'audiobook' && (
          <Cell label="長さ（分）">
            <input
              inputMode="numeric"
              placeholder="任意"
              value={fields.totalMinutes}
              onInput={input('totalMinutes')}
            />
          </Cell>
        )}
        <Cell label="タグ">
          <input
            placeholder="「、」で区切る"
            value={fields.tags}
            onInput={input('tags')}
          />
        </Cell>
      </Group>
      <Group header="メモ">
        <Cell stacked>
          <textarea
            aria-label="メモ"
            rows={4}
            placeholder="感想・引用など"
            value={fields.memo}
            onInput={input('memo')}
          />
        </Cell>
      </Group>
      <Errors errors={errors} />
      <button type="submit" class="button-filled">
        {saved ? '保存しました' : '保存'}
      </button>
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
    <form
      aria-label="進捗"
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
      <Group header={`進捗 · 合計 ${total}${unit}`}>
        <div class="cell log-input">
          <input
            type="date"
            aria-label="日付"
            value={fields.date}
            onInput={(e) =>
              setFields({ ...fields, date: e.currentTarget.value })
            }
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
          <button type="submit" class="button-plain">
            追加
          </button>
        </div>
        {logs.map((l) => (
          <div class="cell" key={l.id}>
            <span class="cell-label">{l.date}</span>
            <span class="cell-value">
              {(audio ? l.minutes : l.pages) ?? 0}
              {unit}
            </span>
            <button
              type="button"
              class="button-plain destructive"
              aria-label={`${l.date}の進捗を削除`}
              onClick={() => void actions.deleteLog(l.id)}
            >
              削除
            </button>
          </div>
        ))}
      </Group>
      <Errors errors={errors} />
    </form>
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
  const back = (
    <a class="back" href={href({ page: 'shelf' })}>
      <span aria-hidden="true">‹</span> 本棚
    </a>
  );
  if (!record || !book)
    return (
      <section>
        {back}
        <div class="empty">
          <h1>記録が見つかりません</h1>
        </div>
      </section>
    );
  const siblings = data.records.filter(
    (r) => r.bookId === book.id && r.id !== record.id,
  );

  return (
    <section>
      {back}
      <BookInfo key={book.id} book={book} actions={actions} />
      <RecordForm key={record.id} record={record} actions={actions} />
      <Logs record={record} data={data} actions={actions} />
      <Group header="この本のほかの記録" label="この本のほかの記録">
        {siblings.map((r) => (
          <a
            key={r.id}
            class="cell cell-link"
            href={href({ page: 'record', id: r.id })}
          >
            <span class="cell-label">{formatLabel[r.format]}</span>
            <span class="cell-value">{statusLabel[r.status]}</span>
            <Icon name="chevron" />
          </a>
        ))}
        {!addingFormat && (
          <button
            type="button"
            class="cell cell-button"
            onClick={() => setAddingFormat(true)}
          >
            この本を別の形式で記録
          </button>
        )}
      </Group>
      {addingFormat && (
        <SaveForm
          getBook={() => book}
          submitLabel="記録を追加"
          onSave={(_book, input) => actions.addRecordForBook(book.id, input)}
        />
      )}
      <Group>
        <button
          type="button"
          class="cell cell-button destructive"
          onClick={() => {
            if (window.confirm(`「${book.title}」のこの記録を削除しますか？`))
              void actions.deleteRecord(record.id);
          }}
        >
          この記録を削除
        </button>
      </Group>
    </section>
  );
}
