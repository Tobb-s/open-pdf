import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { WorkerEngine } from '@/lib/studio/engine';
import { stateAt, type Edit } from '@/lib/studio/script';
import { buildRichPdf, pageWidth } from './helpers/richPdf';

/**
 * The worker path, driven by a stand-in.
 *
 * None of this was testable before: `createStudioEngine` builds a real Worker,
 * Node has none, so every test fell through to the main-thread engine and the
 * three worker-lifecycle fixes — the hang on open, the demotion, the retry —
 * could be deleted without a single test noticing. A seam that takes a Worker
 * makes the failures reproducible.
 */

let fixture: Uint8Array;
const PAGES = 5;

beforeAll(async () => {
  fixture = await buildRichPdf(PAGES);
});

type Handler = ((event: unknown) => void) | null;

/** A Worker that does exactly what a test tells it to, and nothing else. */
class FakeWorker {
  onmessage: Handler = null;
  onerror: Handler = null;
  onmessageerror: Handler = null;
  readonly sent: Array<Record<string, unknown>> = [];
  terminated = false;
  /** When false, messages are swallowed — the worker is dead but silent. */
  alive = true;

  postMessage(message: Record<string, unknown>) {
    this.sent.push(message);
    if (!this.alive) return;
    // Answer `open` the way the real worker does; leave renders to the test.
    if (message.cmd === 'open') queueMicrotask(() => this.reply({ cmd: 'opened' }));
  }

  terminate() {
    this.terminated = true;
    this.alive = false;
  }

  reply(data: unknown) {
    this.onmessage?.({ data } as unknown);
  }

  die() {
    this.alive = false;
  }
}

const asWorker = (fake: FakeWorker) => fake as unknown as Worker;

describe('the worker engine', () => {
  it('opens through the worker and reports it is off the main thread', async () => {
    const fake = new FakeWorker();
    const engine = new WorkerEngine(asWorker(fake));

    await engine.open(fixture);

    expect(engine.offMainThread).toBe(true);
    expect(fake.sent[0]?.cmd).toBe('open');
    engine.dispose();
  });

  it('renders what the worker sends back', async () => {
    const fake = new FakeWorker();
    const engine = new WorkerEngine(asWorker(fake));
    await engine.open(fixture);

    const pending = engine.render(stateAt(PAGES, [], 0));
    // The worker replies with the id it was given.
    await Promise.resolve();
    const request = fake.sent.find((message) => message.cmd === 'render');
    expect(request).toBeDefined();
    fake.reply({
      cmd: 'rendered',
      id: request!.id,
      bytes: new Uint8Array([1, 2, 3]),
      millis: 12,
    });

    const result = await pending;
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.offMainThread).toBe(true);
    engine.dispose();
  });

  it('takes over when the worker reports an error, and finishes the work', async () => {
    const fake = new FakeWorker();
    const engine = new WorkerEngine(asWorker(fake));
    await engine.open(fixture);

    const pending = engine.render(
      stateAt(PAGES, [{ kind: 'delete', page: 'o1' } satisfies Edit], 1)
    );
    await Promise.resolve();
    fake.onerror?.({} as unknown);

    // The reader still gets a document — built here instead.
    const result = await pending;
    expect(result.offMainThread).toBe(false);
    expect(engine.offMainThread).toBe(false);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(PAGES - 1);
    expect(fake.terminated).toBe(true);
    engine.dispose();
  });

  it('does not wait for ever on a worker that died without saying so', async () => {
    // The case that mattered and had no cover: a worker killed by the browser
    // dispatches no event at all, so only a deadline can notice.
    vi.useFakeTimers();
    try {
      const fake = new FakeWorker();
      const engine = new WorkerEngine(asWorker(fake));
      await engine.open(fixture);

      fake.die();
      const pending = engine.render(stateAt(PAGES, [], 0));
      await vi.advanceTimersByTimeAsync(31_000);

      const result = await pending;
      expect(result.offMainThread).toBe(false);
      expect(Array.from(result.bytes)).toEqual(Array.from(fixture));
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not leave `open` pending when the worker never answers', async () => {
    // The exact blank-screen hang: the editor awaited `open` and nothing ever
    // resolved it.
    vi.useFakeTimers();
    try {
      const fake = new FakeWorker();
      fake.die();
      const engine = new WorkerEngine(asWorker(fake));

      let settled = false;
      const opening = engine.open(fixture).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(31_000);
      await opening;

      expect(settled).toBe(true);
      expect(engine.offMainThread).toBe(false);

      // And the session really did carry across: it can still render.
      const result = await engine.render(
        stateAt(PAGES, [{ kind: 'delete', page: 'o0' } satisfies Edit], 1)
      );
      expect((await PDFDocument.load(result.bytes)).getPages()[0].getWidth()).toBe(pageWidth(1));
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries imported assets across a demotion', async () => {
    const extra = await PDFDocument.create();
    extra.addPage([321, 654]);
    const extraBytes = (await extra.save()).slice();

    const fake = new FakeWorker();
    const engine = new WorkerEngine(asWorker(fake));
    await engine.open(fixture);
    engine.putAsset('extra', extraBytes);

    fake.onerror?.({} as unknown);

    const result = await engine.render(
      stateAt(PAGES, [{ kind: 'insert', before: 'o1', asset: 'extra', indices: [0] }], 1)
    );
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(PAGES + 1);
    expect(Math.round(out.getPage(1).getWidth())).toBe(321);
    engine.dispose();
  });

  it('exports through the worker and hands back its report', async () => {
    const fake = new FakeWorker();
    const engine = new WorkerEngine(asWorker(fake));
    await engine.open(fixture);

    const pending = engine.exportDocument(stateAt(PAGES, [], 0));
    await Promise.resolve();
    const request = fake.sent.find((message) => message.cmd === 'export');
    expect(request).toBeDefined();

    const summary = {
      pageCount: 5,
      categories: {
        form: 1,
        bookmarks: 1,
        attachments: 1,
        pageLabels: 1,
        layers: 0,
        accessibility: 0,
        metadataTitle: 1,
        language: 1,
      },
    };
    fake.reply({
      cmd: 'exported',
      id: request!.id,
      bytes: new Uint8Array([9]),
      pages: 5,
      before: summary,
      after: summary,
    });

    const result = await pending;
    expect(result.pages).toBe(5);
    expect(result.before.categories.form).toBe(1);
    engine.dispose();
  });

  it('reports a failure the worker sends rather than hanging', async () => {
    const fake = new FakeWorker();
    const engine = new WorkerEngine(asWorker(fake));
    await engine.open(fixture);

    const pending = engine.render(stateAt(PAGES, [], 0));
    await Promise.resolve();
    const request = fake.sent.find((message) => message.cmd === 'render');
    fake.reply({ cmd: 'failed', id: request!.id, message: 'no se pudo' });

    await expect(pending).rejects.toThrow(/no se pudo/);
    engine.dispose();
  });
});
