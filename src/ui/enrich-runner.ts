import { useEffect, useState } from 'preact/hooks';
import type { Book } from '../domain/book.js';
import { enrichClasses } from '../lookup/enrich.js';
import type {
  EnrichDeps,
  EnrichPatch,
  EnrichProgress,
} from '../lookup/enrich.js';
import { outcomeLabel } from './labels.js';

export interface EnrichState {
  running: boolean;
  progress?: EnrichProgress;
  message?: { text: string; error: boolean };
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
    private readonly deps: EnrichDeps,
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
      progress: { done: 0, total: books.length, filled: 0 },
    });
    let sinceRefresh = 0;
    let message: EnrichState['message'];
    try {
      const result = await enrichClasses(
        books,
        this.deps,
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
      if (result.kind === 'unreachable')
        message = {
          text: `書誌サービスに接続できませんでした（${outcomeLabel[result.reason]}）。時間をおいて試してください。`,
          error: true,
        };
      else if (result.kind === 'aborted')
        message = {
          text: `中止しました（${result.filled}冊を補完）`,
          error: false,
        };
      else
        message = {
          text:
            `${result.total}冊中${result.filled}冊の分類を補完しました` +
            (result.ndlFailure && result.filled < result.total
              ? '。残りは国立国会図書館サーチにこのブラウザから接続できず、補えませんでした'
              : ''),
          error: false,
        };
    } catch (error) {
      message = {
        text: error instanceof Error ? error.message : '補完に失敗しました',
        error: true,
      };
    } finally {
      this.controller = null;
      await this.refresh().catch(() => undefined);
    }
    this.set({ running: false, ...this.progressOf(), message });
  }

  private progressOf(): Pick<EnrichState, 'progress'> {
    return this.state.progress ? { progress: this.state.progress } : {};
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
