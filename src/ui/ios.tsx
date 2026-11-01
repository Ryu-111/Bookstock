import type { ComponentChildren } from 'preact';

/** 角丸のグループ（設定アプリの inset grouped list）。 */
export function Group({
  header,
  footer,
  label,
  children,
}: {
  header?: ComponentChildren;
  footer?: ComponentChildren;
  label?: string;
  children: ComponentChildren;
}) {
  return (
    <section class="group" aria-label={label}>
      {header && <h3 class="group-header">{header}</h3>}
      <div class="group-body">{children}</div>
      {footer && <p class="group-footer">{footer}</p>}
    </section>
  );
}

/** グループの1行。左にラベル、右に値や入力欄を置く。 */
export function Cell({
  label,
  children,
  stacked = false,
  control = true,
}: {
  label?: ComponentChildren;
  children?: ComponentChildren;
  /** メモなど、ラベルの下に入力欄を置く行 */
  stacked?: boolean;
  /**
   * 中身が入力欄1つならtrue（行全体をlabelにする）。
   * ボタンが並ぶ行（セグメント・星）ではfalseにして、ラベルのタップで最初のボタンが押されないようにする。
   */
  control?: boolean;
}) {
  const Tag = control ? 'label' : 'div';
  return (
    <Tag class={stacked ? 'cell cell-stacked' : 'cell'}>
      {label !== undefined && <span class="cell-label">{label}</span>}
      {children}
    </Tag>
  );
}

/** セグメントコントロール。 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** 星の評価。同じ星をもう一度押すと評価なしに戻る。 */
export function Stars({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const current = Number(value) || 0;
  return (
    <div class="stars" role="radiogroup" aria-label="評価">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === current}
          aria-label={`${n}つ星`}
          class={n <= current ? 'on' : ''}
          onClick={() => onChange(n === current ? '' : String(n))}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const ICONS = {
  shelf: 'M4 4h3v16H4zM9 4h3v16H9zM14.2 4.6l2.9-.8 4 15.4-2.9.8z',
  add: 'M12 4v16M4 12h16',
  stats: 'M5 20V12M10 20V6M15 20v-9M20 20V4',
  recommend:
    'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  settings:
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20',
  barcode: 'M4 5v14M7 5v14M10 5v14M13 5v14M15 5v14M18 5v14M20 5v14',
  chevron: 'M9 5l7 7-7 7',
} as const;

/** 線で描いた小さなアイコン（独自の図形）。 */
export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
