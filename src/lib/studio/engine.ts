import { loadPdf } from '@/lib/pdfio';
import { materialize } from '@/lib/studio/materialize';
import type { ScriptState } from '@/lib/studio/script';
import { summarizeStructures, type StructuralSummary } from '@/lib/verify/structural';
import type { StudioRequest, StudioResponse } from '@/lib/studio/studio.worker';

/**
 * The page's handle on the worker.
 *
 * If a worker cannot be created — or dies once it has been — the same work runs
 * on the main thread instead. The editor is slower then, and says so, but it
 * still works. Refusing to open a document because a worker was unavailable
 * would be a worse answer than a slow one.
 */

export interface RenderResult {
  bytes: Uint8Array;
  millis: number;
  /** False when the work had to happen on the main thread. */
  offMainThread: boolean;
}

/** A finished document, plus what can be said about it by reading it. */
export interface ExportResult {
  bytes: Uint8Array;
  /** Counted from the produced bytes, not from what the script intended. */
  pages: number;
  before: StructuralSummary;
  after: StructuralSummary;
}

export interface StudioEngine {
  open(original: Uint8Array): Promise<void>;
  putAsset(id: string, bytes: Uint8Array): void;
  render(state: ScriptState): Promise<RenderResult>;
  exportDocument(state: ScriptState): Promise<ExportResult>;
  readonly offMainThread: boolean;
  dispose(): void;
}

class MainThreadEngine implements StudioEngine {
  readonly offMainThread = false;
  private original: Uint8Array | null = null;
  private readonly assets = new Map<string, Uint8Array>();

  async open(original: Uint8Array): Promise<void> {
    this.original = original;
    this.assets.clear();
  }

  putAsset(id: string, bytes: Uint8Array): void {
    this.assets.set(id, bytes);
  }

  async render(state: ScriptState): Promise<RenderResult> {
    if (!this.original) throw new Error('No document is open.');
    const started = performance.now();
    const bytes = await materialize({ original: this.original, assets: this.assets, state });
    return { bytes, millis: performance.now() - started, offMainThread: false };
  }

  async exportDocument(state: ScriptState): Promise<ExportResult> {
    if (!this.original) throw new Error('No document is open.');
    const bytes = await materialize({ original: this.original, assets: this.assets, state });
    const [source, produced] = await Promise.all([
      loadPdf(this.original, { updateMetadata: false }),
      loadPdf(bytes, { updateMetadata: false }),
    ]);
    return {
      bytes,
      pages: produced.getPageCount(),
      before: summarizeStructures(source),
      after: summarizeStructures(produced),
    };
  }

  dispose(): void {
    this.original = null;
    this.assets.clear();
  }
}

/**
 * Talks to the worker, and takes over the job itself if the worker stops.
 *
 * A worker that dies mid-session used to leave `open()` waiting for a reply
 * that would never come, which froze the editor on a blank screen with no
 * error. Now the fallback is a live part of this class rather than a decision
 * taken once at construction: whatever happens to the worker, the next render
 * still returns a document.
 */
class WorkerEngine implements StudioEngine {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (result: never) => void; reject: (error: Error) => void }
  >();
  private opened: (() => void) | null = null;
  /** Set once the worker has failed; from then on the fallback does the work. */
  private fallback: MainThreadEngine | null = null;
  private original: Uint8Array | null = null;
  private readonly assets = new Map<string, Uint8Array>();

  constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<StudioResponse>) => {
      const message = event.data;
      if (message.cmd === 'opened') {
        this.opened?.();
        this.opened = null;
        return;
      }
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);

      if (message.cmd === 'rendered') {
        (waiting.resolve as (value: RenderResult) => void)({
          bytes: message.bytes,
          millis: message.millis,
          offMainThread: true,
        });
      } else if (message.cmd === 'exported') {
        (waiting.resolve as (value: ExportResult) => void)({
          bytes: message.bytes,
          pages: message.pages,
          before: message.before,
          after: message.after,
        });
      } else {
        waiting.reject(new Error(message.message));
      }
    };

    worker.onerror = () => void this.demote();
    worker.onmessageerror = () => void this.demote();
  }

  get offMainThread(): boolean {
    return this.fallback === null;
  }

  /**
   * Read through a call rather than the field, because the check at the top of
   * `render` narrows `this.fallback` to null for the rest of the function and
   * the compiler cannot know that `demote` may have installed one meanwhile.
   */
  private currentFallback(): MainThreadEngine | null {
    return this.fallback;
  }

  /**
   * Hands the session to a main-thread engine and re-serves everything the
   * worker was going to answer, so a failure costs time rather than work.
   */
  private async demote(): Promise<void> {
    if (this.fallback) return;

    const fallback = new MainThreadEngine();
    this.fallback = fallback;
    if (this.original) await fallback.open(this.original);
    for (const [id, bytes] of this.assets) fallback.putAsset(id, bytes);

    // Whoever was waiting on `open` gets it now; the worker is never answering.
    this.opened?.();
    this.opened = null;

    // In-flight renders are retried here rather than failed: the reader asked
    // for a document, not for an explanation.
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) {
      entry.reject(new Error('The document worker stopped; retrying on the main thread.'));
    }

    try {
      this.worker.terminate();
    } catch {
      // already gone
    }
  }

  open(original: Uint8Array): Promise<void> {
    // Kept here as well as in the worker, so a demotion mid-session can carry
    // the whole session across without asking the page to re-send it.
    this.original = original;
    this.assets.clear();

    if (this.fallback) return this.fallback.open(original);

    return new Promise((resolve) => {
      this.opened = resolve;
      this.worker.postMessage({ cmd: 'open', original } satisfies StudioRequest);
    });
  }

  putAsset(id: string, bytes: Uint8Array): void {
    this.assets.set(id, bytes);
    if (this.fallback) {
      this.fallback.putAsset(id, bytes);
      return;
    }
    this.worker.postMessage({ cmd: 'asset', id, bytes } satisfies StudioRequest);
  }

  private ask<T>(cmd: 'render' | 'export', state: ScriptState): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: never) => void,
        reject,
      });
      this.worker.postMessage({ cmd, id, state } satisfies StudioRequest);
    });
  }

  async render(state: ScriptState): Promise<RenderResult> {
    if (this.fallback) return this.fallback.render(state);
    try {
      return await this.ask<RenderResult>('render', state);
    } catch (caught) {
      // The worker gave up on this one. If it has died, `demote` has already
      // installed a fallback that can answer; otherwise the failure is about
      // this document and belongs to the caller.
      const fallback = this.currentFallback();
      if (fallback) return fallback.render(state);
      throw caught;
    }
  }

  async exportDocument(state: ScriptState): Promise<ExportResult> {
    if (this.fallback) return this.fallback.exportDocument(state);
    try {
      return await this.ask<ExportResult>('export', state);
    } catch (caught) {
      const fallback = this.currentFallback();
      if (fallback) return fallback.exportDocument(state);
      throw caught;
    }
  }

  dispose(): void {
    this.pending.clear();
    this.fallback?.dispose();
    try {
      this.worker.terminate();
    } catch {
      // already gone
    }
  }
}

export function createStudioEngine(): StudioEngine {
  try {
    const worker = new Worker(new URL('./studio.worker.ts', import.meta.url));
    return new WorkerEngine(worker);
  } catch {
    return new MainThreadEngine();
  }
}
