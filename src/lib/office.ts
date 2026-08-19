/**
 * Drives the LibreOffice WebAssembly build to turn Office documents into PDF.
 *
 * The engine is the same one that runs on the desktop, so the output matches
 * what LibreOffice would produce — the whole point of paying its download cost.
 * Everything is served from this origin; nothing is fetched from a CDN.
 */

const LOWA_BASE = '/vendor/lowa/';

/**
 * What the browser actually transfers, measured against the deployed site:
 * 52.4 MB of WebAssembly, 25.5 MB of packed filesystem and 0.2 MB of loader,
 * after compression. Shown before the download starts, because understating it
 * to someone on a phone plan is worse than not offering the tool.
 */
export const ENGINE_DOWNLOAD_BYTES = 78_035_286;

/** Booting takes ~20 s on a fast machine; well past this, something is wrong. */
const ENGINE_START_TIMEOUT_MS = 180_000;

/**
 * Most decks convert in well under a minute — 39 slides with charts took 17 s.
 * But some documents send LibreOffice somewhere it never comes back from, and
 * a spinner that turns forever is the worst possible answer. Five minutes is
 * generous enough for a genuinely heavy file and short enough to stay honest.
 */
const CONVERSION_TIMEOUT_MS = 5 * 60_000;

/** Thrown when a conversion is abandoned, by the clock or by the reader. */
export class ConversionAbandoned extends Error {
  readonly timedOut: boolean;
  constructor(timedOut: boolean) {
    super(timedOut ? 'conversion-timeout' : 'conversion-cancelled');
    this.name = 'ConversionAbandoned';
    this.timedOut = timedOut;
  }
}

export interface OfficeFormat {
  /** Lower-case extension, with the dot. */
  extension: string;
  /** The LibreOffice export filter for the module that owns this format. */
  filter: string;
  /** Key into the dictionary for this family's name. */
  family: 'presentation' | 'document' | 'spreadsheet' | 'drawing';
  /** Legacy binary formats convert, but are worth flagging as unusual. */
  legacy?: boolean;
}

export const OFFICE_FORMATS: OfficeFormat[] = [
  // Presentations. `.ppsx` and `.pps` are the "show" variants: identical files
  // that happen to open straight into the slideshow. Lecturers hand those out
  // constantly, and leaving them off the list rejected most real coursework.
  { extension: '.pptx', filter: 'impress_pdf_Export', family: 'presentation' },
  { extension: '.ppsx', filter: 'impress_pdf_Export', family: 'presentation' },
  { extension: '.pptm', filter: 'impress_pdf_Export', family: 'presentation' },
  { extension: '.ppsm', filter: 'impress_pdf_Export', family: 'presentation' },
  { extension: '.potx', filter: 'impress_pdf_Export', family: 'presentation' },
  { extension: '.ppt', filter: 'impress_pdf_Export', family: 'presentation', legacy: true },
  { extension: '.pps', filter: 'impress_pdf_Export', family: 'presentation', legacy: true },
  { extension: '.odp', filter: 'impress_pdf_Export', family: 'presentation' },
  { extension: '.fodp', filter: 'impress_pdf_Export', family: 'presentation' },

  { extension: '.docx', filter: 'writer_pdf_Export', family: 'document' },
  { extension: '.docm', filter: 'writer_pdf_Export', family: 'document' },
  { extension: '.dotx', filter: 'writer_pdf_Export', family: 'document' },
  { extension: '.doc', filter: 'writer_pdf_Export', family: 'document', legacy: true },
  { extension: '.odt', filter: 'writer_pdf_Export', family: 'document' },
  { extension: '.fodt', filter: 'writer_pdf_Export', family: 'document' },
  { extension: '.rtf', filter: 'writer_pdf_Export', family: 'document' },

  { extension: '.xlsx', filter: 'calc_pdf_Export', family: 'spreadsheet' },
  { extension: '.xlsm', filter: 'calc_pdf_Export', family: 'spreadsheet' },
  { extension: '.xltx', filter: 'calc_pdf_Export', family: 'spreadsheet' },
  { extension: '.xls', filter: 'calc_pdf_Export', family: 'spreadsheet', legacy: true },
  { extension: '.ods', filter: 'calc_pdf_Export', family: 'spreadsheet' },
  { extension: '.fods', filter: 'calc_pdf_Export', family: 'spreadsheet' },

  { extension: '.odg', filter: 'draw_pdf_Export', family: 'drawing' },
];

export const OFFICE_EXTENSIONS = OFFICE_FORMATS.map((format) => format.extension);

/** Which LibreOffice module should open this file, decided by its extension. */
export function formatForFile(fileName: string): OfficeFormat | null {
  const lower = fileName.toLowerCase();
  return (
    OFFICE_FORMATS.find((format) => lower.endsWith(format.extension)) ?? null
  );
}

/** `presentación.pptx` → `presentación.pdf`, whatever the extension's case. */
export function pdfNameFor(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return `${withoutExtension || fileName}.pdf`;
}

type EmscriptenFS = {
  writeFile: (path: string, data: Uint8Array) => void;
  readFile: (path: string) => Uint8Array;
  unlink: (path: string) => void;
};

interface ZetaHelperMainLike {
  start: (onReady: () => void) => void;
  thrPort: { postMessage: (message: unknown) => void; onmessage: ((e: MessageEvent) => void) | null };
  FS: EmscriptenFS;
}

export interface EngineProgress {
  /** 0–1 while the engine downloads, then null once it is booting. */
  fraction: number | null;
  phase: 'downloading' | 'starting';
}

let enginePromise: Promise<OfficeEngine> | null = null;

/**
 * A booted LibreOffice, ready to convert. Only one ever exists per page: the
 * engine is expensive to start and holds hundreds of megabytes.
 */
export class OfficeEngine {
  #helper: ZetaHelperMainLike;
  #nextId = 1;
  #pending = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (e: Error) => void; output: string }>();

  private constructor(helper: ZetaHelperMainLike) {
    this.#helper = helper;
    helper.thrPort.onmessage = (event: MessageEvent) => this.#onMessage(event);
  }

  #onMessage(event: MessageEvent) {
    const message = event.data as { cmd: string; id?: number; message?: string };
    if (message.cmd === 'ready') return;

    const id = message.id;
    if (typeof id !== 'number') return;
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);

    if (message.cmd === 'converted') {
      try {
        const bytes = this.#helper.FS.readFile(pending.output);
        // Copy before unlinking: the array is a view into the worker's heap.
        pending.resolve(bytes.slice());
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        try {
          this.#helper.FS.unlink(pending.output);
        } catch {
          // Nothing useful to do if the scratch file is already gone.
        }
      }
      return;
    }

    pending.reject(new Error(message.message || 'The conversion failed.'));
  }

  /** Converts one document and resolves with the PDF bytes. */
  convert(
    file: File,
    bytes: Uint8Array,
    format: OfficeFormat,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    const id = this.#nextId++;
    // Names inside the engine's own in-memory filesystem, not the user's disk.
    const input = `/tmp/in-${id}${format.extension}`;
    const output = `/tmp/out-${id}.pdf`;

    this.#helper.FS.writeFile(input, bytes);

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, output });

      // A worker stuck inside LibreOffice cannot be interrupted, so giving up
      // means abandoning this engine rather than reusing it: the next attempt
      // boots a clean one from the cached binaries.
      const abandon = (timedOut: boolean) => {
        if (!this.#pending.delete(id)) return;
        retireEngine();
        reject(new ConversionAbandoned(timedOut));
      };

      const timer = setTimeout(() => abandon(true), CONVERSION_TIMEOUT_MS);
      signal?.addEventListener('abort', () => abandon(false), { once: true });

      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        output,
      });

      this.#helper.thrPort.postMessage({
        cmd: 'convert',
        id,
        from: input,
        to: output,
        filter: format.filter,
      });
    }).finally(() => {
      try {
        this.#helper.FS.unlink(input);
      } catch {
        // Same as above: a missing scratch file is not worth reporting.
      }
    });
  }

  static async load(onProgress: (progress: EngineProgress) => void): Promise<OfficeEngine> {
    // Fetching the binaries first, rather than letting Emscripten do it, is what
    // makes a real progress bar possible: a 51 MB download with no feedback is
    // indistinguishable from a hang.
    await warmCache(onProgress);
    onProgress({ fraction: null, phase: 'starting' });

    // zetajs resolves its sibling module from its own URL, so it has to be
    // imported from the served path. The comments stop the bundlers from
    // trying to resolve it at build time.
    const { ZetaHelperMain } = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */
      `${LOWA_BASE}zetajs/zetaHelper.js`
    )) as { ZetaHelperMain: new (threadJs: string, options: object) => ZetaHelperMainLike };

    const helper = new ZetaHelperMain(`${LOWA_BASE}office_thread.js`, {
      wasmPkg: `url:${LOWA_BASE}`,
      threadJsType: 'module',
    });

    // zetajs calls back as soon as it *starts* loading the worker script, not
    // when the script is running. Waiting for the worker's own greeting instead
    // avoids sending it work before it has a listener — which silently loses the
    // first conversion.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('LibreOffice did not finish starting.'));
      }, ENGINE_START_TIMEOUT_MS);

      helper.start(() => {
        helper.thrPort.onmessage = (event: MessageEvent) => {
          if ((event.data as { cmd?: string })?.cmd === 'ready') {
            clearTimeout(timeout);
            resolve();
          }
        };
      });
    });

    return new OfficeEngine(helper);
  }
}

/**
 * Pulls the engine into the HTTP cache with progress, so the browser's own
 * fetch during boot is served from cache.
 */
async function warmCache(onProgress: (progress: EngineProgress) => void): Promise<void> {
  const files = ['soffice.wasm', 'soffice.data'];
  const sizes: number[] = [];
  const loaded: number[] = files.map(() => 0);

  const responses = await Promise.all(
    files.map(async (name) => {
      const response = await fetch(`${LOWA_BASE}${name}`);
      if (!response.ok) {
        throw new Error(`Could not download the conversion engine (${name}).`);
      }
      sizes.push(Number(response.headers.get('content-length')) || 0);
      return response;
    })
  );

  const total = sizes.reduce((sum, size) => sum + size, 0);

  await Promise.all(
    responses.map(async (response, index) => {
      const reader = response.body?.getReader();
      if (!reader) {
        await response.arrayBuffer();
        return;
      }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded[index] += value.byteLength;
        if (total > 0) {
          const sum = loaded.reduce((a, b) => a + b, 0);
          onProgress({ fraction: Math.min(sum / total, 1), phase: 'downloading' });
        }
      }
    })
  );
}

/** Drops the shared engine so the next caller boots a clean one. */
export function retireEngine(): void {
  enginePromise = null;
}

/** Boots the engine once and hands the same instance to every later caller. */
export function getOfficeEngine(
  onProgress: (progress: EngineProgress) => void
): Promise<OfficeEngine> {
  enginePromise ??= OfficeEngine.load(onProgress).catch((error) => {
    // A failed boot must not poison every later attempt.
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

/** True when the browser can run the engine at all. */
export function engineSupported(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}
