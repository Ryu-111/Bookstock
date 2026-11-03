import { useEffect, useState } from 'preact/hooks';
import type { Book } from '../domain/book.js';
import { enrichClasses } from '../lookup/enrich.js';
import type {
  EnrichDeps,
  EnrichPatch,
  EnrichProgress,
  EnrichResult,
  EnrichSource,
} from '../lookup/enrich.js';
import { outcomeLabel } from './labels.js';

export interface EnrichState {
  running: boolean;
  progress?: EnrichProgress;
  message?: { text: string; error: boolean };
}

export const sourceLabel: Record<EnrichSource, string> = {
  openbd: 'openBD',
  rakuten: '楽天ブックス',
  ndl: '国立国会図書館サーチ',
};

/** 終わったときの説明。取得元ごとの冊数と、届かなかった取得元を伝える。 */
export function summarize(
  result: EnrichResult,
): NonNullable<EnrichState['message']> {
  const head =
    result.kind === 'aborted'
      ? `中止しました。${result.filled}冊の分類を補完しました`
      : `${result.total}冊中${result.filled}冊の分類を補完しました`;
  const counts = (Object.keys(sourceLabel) as EnrichSource[])
    .filter((s) => result.bySource[s] > 0)
    .map((s) => `${sourceLabel[s]} ${result.bySource[s]}冊`);
  const down = (Object.keys(sourceLabel) as EnrichSource[]).flatMap((s) => {
    const reason = result.unreachable[s];
    return reason
      ? [`${sourceLabel[s]}に接続できませんでした（${outcomeLabel[reason]}）`]
      : [];
  });
  const text = [
    head + (counts.length > 0 ? `（${counts.join('、')}）` : ''),
    ...down,
  ].join('。');
  return { text, error: result.filled === 0 && down.length > 0 };
}

/** 画面の書き換えをまとめる間隔（冊）。 */
const REFRESH_EVERY = 10;

/**
 * 分類の補完を裏で進める。アプリ全体で1つだけ作り、画面を移っても続ける。
 * 保存は1冊ずつ、画面のデータの読み直しは数冊ごとにまとめる。
 */
export class EnrichRunner {
  private state: EnrichState = { running: false };
  private readonly listeners = new Set<(s: EnrichState) => void>();
  private controller: AbortController | null = null;

  constructor(
    /** 始めるときに読む（楽天の設定が後から変わるため） */
    private readonly deps: () => EnrichDeps,
    private readonly fill: (id: string, patch: EnrichPatch) => Promise<void>,
    private readonly refresh: () => Promise<void>,
  ) {}

  get current(): EnrichState {
    return this.state;
  }

  subscribe(listener: (s: EnrichState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: EnrichState) {
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  stop() {
    this.controller?.abort();
  }

  async start(books: Book[]): Promise<void> {
    if (this.state.running || books.length === 0) return;
    const abort = new AbortController();
    this.controller = abort;
    this.set({
      running: true,
      progress: { source: 'openbd', done: 0, total: books.length, filled: 0 },
    });
    let sinceRefresh = 0;
    let message: NonNullable<EnrichState['message']>;
    try {
      const result = await enrichClasses(
        books,
        this.deps(),
        async (id, patch) => {
          await this.fill(id, patch);
          if (++sinceRefresh >= REFRESH_EVERY) {
            sinceRefresh = 0;
            await this.refresh();
          }
        },
        (progress) => this.set({ running: true, progress }),
        abort.signal,
      );
      message = summarize(result);
    } catch (error) {
      message = {
        text: error instanceof Error ? error.message : '補完に失敗しました',
        error: true,
      };
    } finally {
      this.controller = null;
      await this.refresh().catch(() => undefined);
    }
    this.set({ running: false, message });
  }
}

/** 補完の状態を画面に映す。 */
export function useEnrichState(runner: EnrichRunner | undefined): EnrichState {
  const [state, setState] = useState<EnrichState>(
    () => runner?.current ?? { running: false },
  );
  useEffect(() => {
    if (!runner) return;
    setState(runner.current);
    return runner.subscribe(setState);
  }, [runner]);
  return state;
}
