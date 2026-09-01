import { loadPdf } from '@/lib/pdfio';
import { materialize, type RewriteOutcome } from '@/lib/studio/materialize';
import type { ScriptState } from '@/lib/studio/script';
import { verifyFields, type FieldCheck } from '@/lib/studio/verify';
import { summarizeStructures, type StructuralSummary } from '@/lib/verify/structural';

/**
 * Where pdf-lib lives.
 *
 * Building the document is the one thing in the editor that takes real time,
 * and doing it here keeps the page responsive while it happens — the reader can
 * keep dragging, typing and undoing, and the preview catches up when it is
 * ready. Nothing else in the app is allowed to call pdf-lib on the main thread
 * once the editor is open.
 *
 * The worker holds the original bytes and the imported assets so that a render
 * costs one small message rather than a copy of the whole file.
 */

export type StudioRequest =
  | { cmd: 'open'; original: Uint8Array }
  | { cmd: 'asset'; id: string; bytes: Uint8Array }
  | { cmd: 'render'; id: number; state: ScriptState }
  | { cmd: 'export'; id: number; state: ScriptState };

export type StudioResponse =
  | { cmd: 'opened' }
  | {
      cmd: 'rendered';
      id: number;
      bytes: Uint8Array;
      /** The page ids really in those bytes, in the order the document holds them. */
      placed: string[];
      millis: number;
      /** What became of each word replacement, so the page can say. */
      rewrites: RewriteOutcome[];
    }
  | {
      cmd: 'exported';
      id: number;
      bytes: Uint8Array;
      pages: number;
      /** The page ids really in those bytes, in the order the document holds them. */
      placed: string[];
      before: StructuralSummary;
      after: StructuralSummary;
      /** Field values that did not survive the write, read back from the file. */
      fields: FieldCheck[];
    }
  | { cmd: 'failed'; id: number; message: string };

let original: Uint8Array | null = null;
const assets = new Map<string, Uint8Array>();

const post = (message: StudioResponse, transfer: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(message, transfer);
};

self.onmessage = async (event: MessageEvent<StudioRequest>) => {
  const request = event.data;

  if (request.cmd === 'open') {
    original = request.original;
    assets.clear();
    post({ cmd: 'opened' });
    return;
  }

  if (request.cmd === 'asset') {
    assets.set(request.id, request.bytes);
    return;
  }

  if (request.cmd === 'export') {
    if (!original) {
      post({ cmd: 'failed', id: request.id, message: 'No document is open.' });
      return;
    }
    try {
      const { bytes, pages: placed } = await materialize({
        original,
        assets,
        state: request.state,
      });
      // Read from the produced bytes, here, where pdf-lib already lives. Doing
      // it on the page would parse two whole documents on the main thread — the
      // one thing this file exists to prevent.
      const [source, produced] = await Promise.all([
        loadPdf(original, { updateMetadata: false }),
        loadPdf(bytes, { updateMetadata: false }),
      ]);
      post(
        {
          cmd: 'exported',
          id: request.id,
          bytes,
          pages: produced.getPageCount(),
          placed,
          before: summarizeStructures(source),
          after: summarizeStructures(produced),
          fields: await verifyFields(bytes, request.state.fields),
        },
        [bytes.buffer as ArrayBuffer]
      );
    } catch (caught) {
      post({
        cmd: 'failed',
        id: request.id,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
    return;
  }

  if (request.cmd === 'render') {
    if (!original) {
      post({ cmd: 'failed', id: request.id, message: 'No document is open.' });
      return;
    }
    // Measured here rather than on the page: this is the number that decides
    // whether the converging preview can keep up, and it must not include the
    // time a busy main thread spent getting round to the reply.
    const started = performance.now();
    try {
      const { bytes, pages: placed, rewrites } = await materialize({
        original,
        assets,
        state: request.state,
      });
      post(
        {
          cmd: 'rendered',
          id: request.id,
          bytes,
          placed,
          rewrites,
          millis: performance.now() - started,
        },
        // The worker has no further use for these, so hand the memory over
        // instead of copying a whole document across the boundary.
        [bytes.buffer as ArrayBuffer]
      );
    } catch (caught) {
      post({
        cmd: 'failed',
        id: request.id,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }
};
