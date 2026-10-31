import { useState } from 'preact/hooks';
import { parseManualBook } from '../domain/manual.js';
import type { ManualFields } from '../domain/manual.js';
import { Cell, Group } from './ios.js';
import { SaveForm } from './save-form.js';
import type { SaveHandler } from './save-form.js';

const fieldLabels: [keyof ManualFields, string, string, string?][] = [
  ['title', 'タイトル', '必須'],
  ['authors', '著者', '「、」で区切る'],
  ['publisher', '出版社', '任意'],
  ['publishedDate', '出版日', '2024-03'],
  ['pageCount', 'ページ数', '任意', 'numeric'],
  ['isbn', 'ISBN', '電子・オーディオは空欄可', 'numeric'],
];

/** 本の情報の入力欄（登録と編集で共通）。 */
export function BookFields({
  fields,
  onChange,
}: {
  fields: ManualFields;
  onChange: (fields: ManualFields) => void;
}) {
  return (
    <Group header="本の情報">
      {fieldLabels.map(([key, label, placeholder, inputMode]) => (
        <Cell key={key} label={label}>
          <input
            value={fields[key]}
            placeholder={placeholder}
            inputMode={inputMode === 'numeric' ? 'numeric' : undefined}
            onInput={(e) =>
              onChange({ ...fields, [key]: e.currentTarget.value })
            }
          />
        </Cell>
      ))}
    </Group>
  );
}

/** ISBNのない電子書籍・オーディオブックや、検索で見つからない本を登録する。 */
export function ManualForm({
  initial,
  onSave,
}: {
  initial: ManualFields;
  onSave: SaveHandler;
}) {
  const [fields, setFields] = useState(initial);
  return (
    <section aria-label="手入力で登録">
      <BookFields fields={fields} onChange={setFields} />
      <SaveForm
        getBook={() => {
          const result = parseManualBook(fields);
          return result.ok ? result.value : result.errors;
        }}
        onSave={onSave}
      />
    </section>
  );
}
