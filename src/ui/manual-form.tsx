import { useState } from 'preact/hooks';
import { parseManualBook } from '../domain/manual.js';
import type { ManualFields } from '../domain/manual.js';
import { SaveForm } from './save-form.js';
import type { SaveHandler } from './save-form.js';

const fieldLabels: [keyof ManualFields, string, string?][] = [
  ['title', 'タイトル（必須）'],
  ['authors', '著者', '「、」で区切る'],
  ['publisher', '出版社'],
  ['publishedDate', '出版日', '2024-03'],
  ['pageCount', 'ページ数'],
  ['isbn', 'ISBN', '電子書籍・オーディオブックは空欄でよい'],
];

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
      <h3>手入力で登録</h3>
      {fieldLabels.map(([key, label, placeholder]) => (
        <label key={key} class="field">
          {label}
          <input
            value={fields[key]}
            placeholder={placeholder}
            onInput={(e) =>
              setFields({ ...fields, [key]: e.currentTarget.value })
            }
          />
        </label>
      ))}
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
