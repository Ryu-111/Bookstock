import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { FORMATS, STATUSES } from '../domain/book.js';
import type { ExportFile } from '../domain/book.js';
import { computeStats } from '../domain/stats.js';
import type { Amount, Bucket, Period, Stats } from '../domain/stats.js';
import { Group, Segmented } from './ios.js';
import { formatShortLabel, statusLabel, todayLocal } from './labels.js';

const num = (n: number) => n.toLocaleString('ja-JP');

/** 分を「12時間30分」の形にする。 */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

type Metric = 'count' | 'pages' | 'minutes';
const METRICS: readonly (readonly [Metric, string])[] = [
  ['count', '冊'],
  ['pages', 'ページ'],
  ['minutes', '時間'],
];
const metricValue = (a: Amount, metric: Metric) => a[metric];
const metricText = (value: number, metric: Metric) =>
  metric === 'count'
    ? `${num(value)}冊`
    : metric === 'pages'
      ? `${num(value)}ページ`
      : formatMinutes(value);

/** 要素の幅を追う（グラフを画面幅に合わせて描くため）。 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 0から始まる、きりのよい目盛り。 */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 3;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(t);
  if ((ticks.at(-1) ?? 0) < max) ticks.push(ticks.length * step);
  return ticks.map((t) => Math.round(t * 100) / 100);
}

function Legend() {
  return (
    <ul class="legend" aria-label="凡例">
      {FORMATS.map((f) => (
        <li key={f}>
          <span class={`swatch fmt-${f}`} aria-hidden="true" />
          {formatShortLabel[f]}
        </li>
      ))}
    </ul>
  );
}

/** 形式別の積み上げ棒グラフ（軸は1本）。 */
function BarChart({ buckets, metric }: { buckets: Bucket[]; metric: Metric }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 200;
  const pad = { top: 12, right: 4, bottom: 24, left: 40 };
  const max = Math.max(...buckets.map((b) => metricValue(b.total, metric)), 0);
  const ticks = niceTicks(metric === 'minutes' ? max / 60 : max).map((t) =>
    metric === 'minutes' ? t * 60 : t,
  );
  const top = ticks.at(-1) ?? 1;
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const slot = buckets.length > 0 ? plotW / buckets.length : 0;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(buckets.length / Math.max(1, plotW / 30));
  const tick = (v: number) =>
    metric === 'minutes' ? `${num(v / 60)}h` : num(v);

  const activeBucket = active === null ? undefined : buckets[active];
  const total = buckets.reduce(
    (sum, b) => sum + metricValue(b.total, metric),
    0,
  );
  return (
    <div class="chart" ref={ref}>
      <p class="readout" role="status">
        {activeBucket ? (
          <>
            <strong>{activeBucket.label}</strong>
            {FORMATS.map((f) => (
              <span key={f}>
                <span class={`swatch fmt-${f}`} aria-hidden="true" />
                {formatShortLabel[f]}{' '}
                {metricText(
                  metricValue(activeBucket.byFormat[f], metric),
                  metric,
                )}
              </span>
            ))}
            <span>
              計 {metricText(metricValue(activeBucket.total, metric), metric)}
            </span>
          </>
        ) : (
          <>
            <strong>合計 {metricText(total, metric)}</strong>
            <span>棒をタップすると内訳を表示</span>
          </>
        )}
      </p>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="月別の読了（形式別の積み上げ棒グラフ）。詳しい値は表で確認できます"
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                class="grid"
                x1={pad.left}
                x2={width - pad.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text
                class="axis"
                x={pad.left - 6}
                y={y(t)}
                dy="0.35em"
                text-anchor="end"
              >
                {tick(t)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = pad.left + slot * i + (slot - barW) / 2;
            let base = 0;
            const segments = FORMATS.map((f) => {
              const v = metricValue(b.byFormat[f], metric);
              const seg = { f, from: base, to: base + v };
              base += v;
              return seg;
            }).filter((s) => s.to > s.from);
            const last = segments.at(-1)?.f;
            return (
              <g
                key={b.key}
                class={active !== null && active !== i ? 'dim' : ''}
              >
                {segments.map((s) => {
                  const y1 = y(s.to);
                  // 積み上げの間に2pxのすき間（面の色）を空ける
                  const h = Math.max(0, y(s.from) - y1 - (s.from > 0 ? 2 : 0));
                  return s.f === last ? (
                    <path
                      key={s.f}
                      class={`bar fmt-${s.f}`}
                      d={roundedTop(x, y1, barW, h, Math.min(4, barW / 2, h))}
                    />
                  ) : (
                    <rect
                      key={s.f}
                      class={`bar fmt-${s.f}`}
                      x={x}
                      y={y1}
                      width={barW}
                      height={h}
                    />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text
                    class="axis"
                    x={pad.left + slot * i + slot / 2}
                    y={height - 6}
                    text-anchor="middle"
                  >
                    {b.label}
                  </text>
                )}
                <rect
                  class="hit"
                  x={pad.left + slot * i}
                  y={pad.top}
                  width={slot}
                  height={plotH}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => setActive(active === i ? null : i)}
                />
              </g>
            );
          })}
          <line
            class="baseline"
            x1={pad.left}
            x2={width - pad.right}
            y1={y(0)}
            y2={y(0)}
          />
        </svg>
      )}
    </div>
  );
}

/** 上の角だけ丸めた長方形。 */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function BucketTable({ buckets }: { buckets: Bucket[] }) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">期間</th>
            {FORMATS.map((f) => (
              <th key={f} scope="col">
                {formatShortLabel[f]}
              </th>
            ))}
            <th scope="col">ページ</th>
            <th scope="col">時間</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.label}</th>
              {FORMATS.map((f) => (
                <td key={f}>{b.byFormat[f].count}</td>
              ))}
              <td>{num(b.total.pages)}</td>
              <td>{formatMinutes(b.total.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 日ごとの活動のヒートマップ（単色の濃淡）。量はページ＋分で数える。 */
function Calendar({ stats }: { stats: Stats }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string>();
  const byDate = new Map(stats.calendar.map((d) => [d.date, d]));
  const from = Date.parse(`${stats.calendarRange.from}T00:00:00Z`);
  const to = Date.parse(`${stats.calendarRange.to}T00:00:00Z`);
  const startDow = (new Date(from).getUTCDay() + 6) % 7; // 月曜始まり
  const days = Math.round((to - from) / 86_400_000) + 1;
  const weeks = Math.ceil((startDow + days) / 7);
  const values = stats.calendar.map((d) => d.pages + d.minutes);
  const max = Math.max(1, ...values);
  const level = (date: string) => {
    const d = byDate.get(date);
    if (!d) return 0;
    const v = d.pages + d.minutes;
    if (v === 0) return d.finished > 0 ? 1 : 0;
    return Math.min(4, Math.max(1, Math.ceil((v / max) * 4)));
  };
  const cell = 11;
  const gap = 2;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [stats.calendarRange.to]);

  const pickedDay = picked ? byDate.get(picked) : undefined;
  return (
    <div>
      <div class="calendar-scroll" ref={scroller}>
        <svg
          width={weeks * (cell + gap)}
          height={7 * (cell + gap)}
          role="img"
          aria-label="読書カレンダー。色が濃い日ほど多く読んでいます"
        >
          {Array.from({ length: days }, (_, i) => {
            const date = new Date(from + i * 86_400_000)
              .toISOString()
              .slice(0, 10);
            const index = startDow + i;
            const d = byDate.get(date);
            return (
              <rect
                key={date}
                class={`day lv${level(date)}${picked === date ? ' picked' : ''}`}
                x={Math.floor(index / 7) * (cell + gap)}
                y={(index % 7) * (cell + gap)}
                width={cell}
                height={cell}
                rx={2}
                onClick={() => setPicked(picked === date ? undefined : date)}
              >
                <title>
                  {date}
                  {d
                    ? ` ${[
                        d.pages && `${d.pages}ページ`,
                        d.minutes && `${d.minutes}分`,
                        d.finished && `読了${d.finished}冊`,
                      ]
                        .filter(Boolean)
                        .join('・')}`
                    : ''}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div class="calendar-foot">
        <span class="footnote">
          {picked
            ? `${picked}: ${
                pickedDay
                  ? [
                      pickedDay.pages && `${pickedDay.pages}ページ`,
                      pickedDay.minutes && `${pickedDay.minutes}分`,
                      pickedDay.finished && `読了${pickedDay.finished}冊`,
                    ]
                      .filter(Boolean)
                      .join('・') || '記録なし'
                  : '記録なし'
              }`
            : '日付をタップすると詳細を表示'}
        </span>
        <span class="scale" aria-hidden="true">
          少
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} class={`day-swatch lv${l}`} />
          ))}
          多
        </span>
      </div>
    </div>
  );
}

/** 横棒の一覧（状態・評価・分類）。値は文字でも出す。 */
function HBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul class="hbars">
      {rows.map((r) => (
        <li key={r.label}>
          <span class="hbar-label">{r.label}</span>
          <span class="hbar-track">
            <span class="hbar" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span class="hbar-value">{num(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function Tile({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}) {
  return (
    <div class="tile">
      <span class="tile-label">{label}</span>
      <span class="tile-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {note && <span class="tile-note">{note}</span>}
    </div>
  );
}

type PeriodChoice = 'this' | 'last' | 'all' | 'other';

export function StatsPage({ data }: { data: ExportFile }) {
  const today = todayLocal();
  const thisYear = Number(today.slice(0, 4));
  const [choice, setChoice] = useState<PeriodChoice>('this');
  const [otherYear, setOtherYear] = useState(thisYear - 2);
  const [metric, setMetric] = useState<Metric>('count');
  const [showTable, setShowTable] = useState(false);

  const period: Period =
    choice === 'all'
      ? { kind: 'all' }
      : {
          kind: 'year',
          year:
            choice === 'this'
              ? thisYear
              : choice === 'last'
                ? thisYear - 1
                : otherYear,
        };
  const stats = computeStats(data, period, today);
  const olderYears = stats.years.filter((y) => y < thisYear - 1);
  const f = stats.finished;

  return (
    <section class="stats">
      <h1 class="large-title">統計</h1>
      <div class="period-row">
        <Segmented
          label="期間"
          options={[
            ['this', `${thisYear}年`],
            ['last', `${thisYear - 1}年`],
            ['all', '全期間'],
            ...(olderYears.length > 0 ? [['other', 'ほか'] as const] : []),
          ]}
          value={choice}
          onChange={setChoice}
        />
        {choice === 'other' && olderYears.length > 0 && (
          <select
            aria-label="年を選ぶ"
            class="year-select"
            value={String(otherYear)}
            onChange={(e) => {
              const y = olderYears.find(
                (v) => String(v) === e.currentTarget.value,
              );
              if (y) setOtherYear(y);
            }}
          >
            {olderYears.map((y) => (
              <option key={y} value={String(y)}>
                {y}年
              </option>
            ))}
          </select>
        )}
      </div>

      <div class="tiles">
        <Tile
          label="読了"
          value={num(f.count)}
          unit="冊"
          {...(f.uniqueBooks !== f.count
            ? { note: `本としては${num(f.uniqueBooks)}冊` }
            : {})}
        />
        <Tile
          label="ページ"
          value={num(f.pages)}
          {...(stats.days > 0
            ? { note: `1日あたり${num(stats.pagesPerDay)}ページ` }
            : {})}
        />
        <Tile
          label="聴いた時間"
          value={num(Math.round(f.minutes / 6) / 10)}
          unit="時間"
          note={`オーディオ${num(f.byFormat.audiobook.count)}冊`}
        />
        <Tile
          label="月平均"
          value={num(stats.booksPerMonth)}
          unit="冊"
          {...(stats.best && stats.best.total.count > 0
            ? { note: `最多は${stats.best.label}の${stats.best.total.count}冊` }
            : {})}
        />
      </div>

      <Group
        header={stats.granularity === 'year' ? '年別の読了' : '月別の読了'}
        label="月別の読了"
      >
        <div class="card-body">
          <div class="chart-head">
            <Legend />
            <Segmented
              label="指標"
              options={METRICS}
              value={metric}
              onChange={setMetric}
            />
          </div>
          {f.count === 0 ? (
            <p class="footnote">この期間に読了した本はありません</p>
          ) : showTable ? (
            <BucketTable buckets={stats.buckets} />
          ) : (
            <BarChart buckets={stats.buckets} metric={metric} />
          )}
          <button
            type="button"
            class="button-plain"
            onClick={() => setShowTable(!showTable)}
          >
            {showTable ? 'グラフで見る' : '表で見る'}
          </button>
        </div>
      </Group>

      <Group
        header="読書カレンダー"
        label="読書カレンダー"
        footer="進捗のページ数と分を合わせた量で色の濃さを決めています。読了した日も色が付きます。"
      >
        <div class="card-body">
          <Calendar stats={stats} />
        </div>
      </Group>

      <Group header="いまの状態" label="いまの状態">
        <div class="card-body">
          <HBars
            rows={STATUSES.map((s) => ({
              label: statusLabel[s],
              value: stats.statuses[s],
            }))}
          />
        </div>
      </Group>

      {f.count > 0 && (
        <Group header="評価" label="評価">
          <div class="card-body">
            <HBars
              rows={[5, 4, 3, 2, 1]
                .map((n) => ({
                  label: '★'.repeat(n),
                  value: stats.ratings[n] ?? 0,
                }))
                .concat([{ label: '評価なし', value: stats.ratings[0] }])}
            />
          </div>
        </Group>
      )}

      {stats.ndc.length > 0 && (
        <Group
          header="分類（NDC）"
          label="分類"
          {...(stats.unclassified > 0
            ? { footer: `分類のない本が${stats.unclassified}冊あります。` }
            : {})}
        >
          <div class="card-body">
            <HBars
              rows={stats.ndc.map((x) => ({ label: x.label, value: x.count }))}
            />
          </div>
        </Group>
      )}

      <Notes stats={stats} />
    </section>
  );
}

/** 正確さの限界を書く。 */
function Notes({ stats }: { stats: Stats }) {
  const notes = [
    stats.undated > 0 &&
      `読了日のない読了記録が${stats.undated}件あり、集計に含めていません。記録の画面で読了日を入れると反映されます。`,
    stats.pagesMissing > 0 &&
      `ページ数のない本が${stats.pagesMissing}冊あり、ページ数は0として数えています。`,
    stats.minutesMissing > 0 &&
      `長さのないオーディオブックが${stats.minutesMissing}件あり、時間は0として数えています。`,
  ].filter((n): n is string => typeof n === 'string');
  if (notes.length === 0) return null;
  return (
    <ul class="notes" aria-label="集計の注意">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
