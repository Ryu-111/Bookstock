import { useState } from 'preact/hooks';
import type { ExportFile } from '../domain/book.js';
import { MIN_BOOKS, chaosMap, readingTypes } from '../domain/insights.js';
import type { MapRegion } from '../domain/insights.js';
import type { Period } from '../domain/stats.js';
import { Cover } from './cover.js';
import { Group, Icon } from './ios.js';
import { href } from './route.js';

/** 読み方のタイプ診断。 */
export function Diagnosis({
  data,
  period,
}: {
  data: ExportFile;
  period: Period;
}) {
  const d = readingTypes(data, period);
  return (
    <section class="insight" aria-label="読み方のタイプ">
      <h2 class="rec-title">読み方のタイプ</h2>
      {!d.enough ? (
        <p class="footnote">あと{MIN_BOOKS - d.count}冊読むと判定できます</p>
      ) : (
        <>
          <p class="headline">{d.headline}</p>
          <div class="type-grid">
            {d.types.map((t) => (
              <div
                key={t.axis}
                class={t.keyword ? 'type-card hit' : 'type-card'}
              >
                <strong>{t.label}</strong>
                <span>{t.detail}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const COVERS_PER_REGION = 12;

function RegionSheet({
  region,
  onClose,
}: {
  region: MapRegion;
  onClose: () => void;
}) {
  return (
    <div
      class="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${region.name}の本`}
      onClick={onClose}
    >
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-head">
          <button type="button" class="button-plain" onClick={onClose}>
            閉じる
          </button>
          <strong>
            {region.name}（{region.count}冊）
          </strong>
          <span class="sheet-spacer" />
        </div>
        {region.divisions.map((d) => (
          <Group key={d.code} header={`${d.name}・${d.items.length}冊`}>
            {d.items.map(({ record, book }) => (
              <a
                key={record.id}
                class="cell cell-link"
                href={href({ page: 'record', id: record.id })}
                onClick={onClose}
              >
                <span class="cell-label cell-title">{book.title}</span>
                <span class="cell-value">{book.authors[0] ?? ''}</span>
                <Icon name="chevron" />
              </a>
            ))}
          </Group>
        ))}
      </div>
    </div>
  );
}

/** 読了した本を分類ごとの区画に並べた「読書マップ」（カオスマップ風）。 */
export function ReadingMap({
  data,
  period,
}: {
  data: ExportFile;
  period: Period;
}) {
  const [open, setOpen] = useState<MapRegion>();
  const regions = chaosMap(data, period);
  if (regions.length === 0) return null;
  const unclassified = regions.find((r) => r.classCode === -1)?.count ?? 0;
  const total = regions.reduce((n, r) => n + r.count, 0);

  return (
    <section class="insight" aria-label="読書マップ">
      <h2 class="rec-title">読書マップ</h2>
      {unclassified / total >= 0.3 && (
        <p class="footnote">
          分類なし {unclassified}冊・
          <a href={href({ page: 'settings' })}>補完する</a>
        </p>
      )}
      <div class="chaos-map">
        {regions.map((r) => {
          let shown = 0;
          return (
            <button
              key={r.classCode}
              type="button"
              class={`region region-${r.classCode < 0 ? 'none' : r.classCode}`}
              style={{
                flex: `${r.count} 1 ${Math.min(320, 120 + r.count * 8)}px`,
              }}
              onClick={() => setOpen(r)}
              aria-label={`${r.name} ${r.count}冊`}
            >
              <span class="region-head">
                <strong>{r.name}</strong>
                <span>{r.count}冊</span>
              </span>
              {r.divisions.map((d) => {
                const room = COVERS_PER_REGION - shown;
                const covers = d.items.slice(0, Math.max(0, room));
                shown += covers.length;
                return (
                  <span key={d.code} class="division">
                    <span class="division-name">
                      {d.name} {d.items.length}
                    </span>
                    {covers.length > 0 && (
                      <span class="mini-covers">
                        {covers.map(({ record, book }) => (
                          <Cover key={record.id} book={book} />
                        ))}
                      </span>
                    )}
                  </span>
                );
              })}
              {r.count > shown && (
                <span class="more">ほか{r.count - shown}冊</span>
              )}
            </button>
          );
        })}
      </div>
      {open && <RegionSheet region={open} onClose={() => setOpen(undefined)} />}
    </section>
  );
}
