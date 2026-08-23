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

/** Which half of the work the engine is in. */
export type ConversionPhase = 'opening' | 'exporting';

/** Thrown when a conversion is abandoned, by the clock or by the reader. */
export class ConversionAbandoned extends Error {
  readonly timedOut: boolean;
  /** Where it got stuck, when the engine got far enough to say. */
  readonly phase: ConversionPhase | null;
  constructor(timedOut: boolean, phase: ConversionPhase | null) {
    super(timedOut ? 'conversion-timeout' : 'conversion-cancelled');
    this.name = 'ConversionAbandoned';
    this.timedOut = timedOut;
    this.phase = phase;
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

/**
 * Gives every entry of a batch a distinct name.
 *
 * Two lectures called `Clase 1.pptx` from different folders are ordinary, and a
 * zip that silently kept only one of them would lose someone's work.
 */
export function uniqueNames(fileNames: readonly string[]): string[] {
  // Keyed on the names actually handed out, not on how often a base repeats.
  // Counting repeats alone invents a suffix that can collide with a name another
  // file already owns — `Clase 1.pptx`, `Clase 1.docx`, `Clase 1 (2).pptx` all
  // wanted `Clase 1 (2).pdf`, and a zip keeps only the last writer.
  const taken = new Set<string>();

  return fileNames.map((fileName) => {
    const base = pdfNameFor(fileName);
    let candidate = base;
    let suffix = 2;

    while (taken.has(candidate.toLowerCase())) {
      candidate = base.replace(/\.pdf$/i, ` (${suffix}).pdf`);
      suffix += 1;
    }

    taken.add(candidate.toLowerCase());
    return candidate;
  });
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
  /**
   * 0–1 while the engine downloads and the total is known; null while it is
   * booting, and ALSO null while downloading with no total to divide by.
   */
  fraction: number | null;
  /** Bytes received so far, decoded. Shown on its own when `fraction` is null. */
  loadedBytes?: number;
  /** What is expected in all, or null when nothing could say. */
  totalBytes?: number | null;
  phase: 'downloading' | 'starting';
}

/** Where the build writes the size of every vendored file. */
const MANIFEST_URL = '/vendor/manifest.json';

/**
 * The sizes the build recorded for these files, by name.
 *
 * The download used to divide by `content-length`, which is exactly the header
 * a browser does not get: it asks with `Accept-Encoding: br`, the CDN answers
 * compressed and chunked, and there is no length at all. `total` came out as
 * zero, the `if (total > 0)` around the progress callback never fired, and the
 * bar sat at 0% for a quarter of a gigabyte — which reads as hung. The build
 * already writes every file's decoded size into the manifest, and decoded is
 * what the stream reader counts, so the two agree.
 */
export function sizesFromManifest(
  manifest: unknown,
  files: readonly string[]
): Map<string, number> {
  const sizes = new Map<string, number>();
  if (!manifest || typeof manifest !== 'object') return sizes;
  const entries = (manifest as { files?: unknown }).files;
  if (!Array.isArray(entries)) return sizes;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const { file, bytes } = entry as { file?: unknown; bytes?: unknown };
    if (typeof file !== 'string' || typeof bytes !== 'number' || bytes <= 0) continue;
    if (!file.startsWith('lowa/')) continue;
    const name = file.slice('lowa/'.length);
    if (files.includes(name)) sizes.set(name, bytes);
  }
  return sizes;
}

/**
 * Progress from per-file counts.
 *
 * A fraction is only offered when EVERY size is known: a partial total would
 * make the bar run past the end and sit at 100% while bytes still arrive, which
 * is the same lie as 0% told the other way. Otherwise the bytes so far are
 * reported on their own, and the interface shows those instead of a percentage.
 */
export function downloadProgress(
  loaded: readonly number[],
  sizes: ReadonlyArray<number | null>
): Pick<EngineProgress, 'fraction' | 'loadedBytes' | 'totalBytes'> {
  const loadedBytes = loaded.reduce((sum, bytes) => sum + bytes, 0);
  const known = sizes.every((size): size is number => size !== null && size > 0);
  if (!known) return { fraction: null, loadedBytes, totalBytes: null };
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  return { fraction: Math.min(loadedBytes / totalBytes, 1), loadedBytes, totalBytes };
}

let enginePromise: Promise<OfficeEngine> | null = null;

/**
 * A booted LibreOffice, ready to convert. Only one ever exists per page: the
 * engine is expensive to start and holds hundreds of megabytes.
 */
export class OfficeEngine {
  #helper: ZetaHelperMainLike;
  #nextId = 1;
  #pending = new Map<
    number,
    {
      resolve: (bytes: Uint8Array) => void;
      reject: (e: Error) => void;
      output: string;
      phase: ConversionPhase | null;
      onPhase?: (phase: ConversionPhase) => void;
    }
  >();

  private constructor(helper: ZetaHelperMainLike) {
    this.#helper = helper;
    helper.thrPort.onmessage = (event: MessageEvent) => this.#onMessage(event);
  }

  #onMessage(event: MessageEvent) {
    const message = event.data as {
      cmd: string;
      id?: number;
      message?: string;
      phase?: ConversionPhase;
    };
    if (message.cmd === 'ready') return;

    const id = message.id;
    if (typeof id !== 'number') return;
    const pending = this.#pending.get(id);
    if (!pending) return;

    if (message.cmd === 'phase' && message.phase) {
      pending.phase = message.phase;
      pending.onPhase?.(message.phase);
      return;
    }

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
    signal?: AbortSignal,
    onPhase?: (phase: ConversionPhase) => void
  ): Promise<Uint8Array> {
    const id = this.#nextId++;
    // Names inside the engine's own in-memory filesystem, not the user's disk.
    const input = `/tmp/in-${id}${format.extension}`;
    const output = `/tmp/out-${id}.pdf`;

    // A batch shares one signal across every document, so a cancel that landed
    // between two of them has to be seen here rather than waited for.
    if (signal?.aborted) {
      return Promise.reject(new ConversionAbandoned(false, null));
    }

    this.#helper.FS.writeFile(input, bytes);

    return new Promise<Uint8Array>((resolve, reject) => {
      // A worker stuck inside LibreOffice cannot be interrupted, so giving up
      // means abandoning this engine rather than reusing it: the next attempt
      // boots a clean one from the cached binaries.
      const onAbort = () => abandon(false);

      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };

      const abandon = (timedOut: boolean) => {
        const entry = this.#pending.get(id);
        if (!entry) return;
        this.#pending.delete(id);
        settle();
        // The worker may still be inside LibreOffice and may yet write its
        // output; drop the scratch file so an abandoned run does not sit in the
        // engine's filesystem for the rest of the session.
        try {
          this.#helper.FS.unlink(entry.output);
        } catch {
          // It was never written, which is the common case.
        }
        retireEngine();
        reject(new ConversionAbandoned(timedOut, entry.phase));
      };

      // Declared after the helpers above; they only read it once it is set.
      const timer = setTimeout(() => abandon(true), CONVERSION_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, { once: true });

      this.#pending.set(id, {
        resolve: (value) => {
          settle();
          resolve(value);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
        output,
        phase: null,
        onPhase,
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
  const loaded: number[] = files.map(() => 0);

  // The build's own record of the sizes, fetched first because it is tiny.
  // Anything that goes wrong here degrades to "unknown", never to a guess.
  let known = new Map<string, number>();
  try {
    const response = await fetch(MANIFEST_URL);
    if (response.ok) known = sizesFromManifest(await response.json(), files);
  } catch {
    // No manifest, no sizes: the bytes so far are still reported honestly.
  }

  const responses = await Promise.all(
    files.map(async (name) => {
      const response = await fetch(`${LOWA_BASE}${name}`);
      if (!response.ok) {
        throw new Error(`Could not download the conversion engine (${name}).`);
      }
      return response;
    })
  );

  // By name, not by arrival order. `content-length` is the fallback, and it
  // is usually absent: a browser asks compressed and the CDN answers chunked.
  const sizes: Array<number | null> = files.map((name, index) => {
    const recorded = known.get(name);
    if (recorded !== undefined) return recorded;
    const header = Number(responses[index].headers.get('content-length')) || 0;
    return header > 0 ? header : null;
  });

  const report = () => onProgress({ ...downloadProgress(loaded, sizes), phase: 'downloading' });
  report();

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
        report();
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

const RELOAD_FLAG = 'openpdf:office-reloaded';

export type IsolationStatus = 'ready' | 'retrying' | 'unsupported';

/**
 * Whether the page can run the engine, and if not, whether it is worth reloading.
 *
 * Cross-origin isolation is granted by headers on the document response. Reaching
 * this route through a client-side navigation means no document was ever fetched,
 * so the headers never applied and isolation is missing even in a browser that
 * fully supports it. One reload fixes that; a second would mean the browser
 * genuinely cannot do it, so the flag stops it looping.
 */
export function isolationStatus(): IsolationStatus {
  if (engineSupported()) return 'ready';
  try {
    return sessionStorage.getItem(RELOAD_FLAG) ? 'unsupported' : 'retrying';
  } catch {
    // Private modes can refuse sessionStorage; without somewhere to record the
    // attempt, reloading risks a loop, so treat it as unsupported.
    return 'unsupported';
  }
}

/** Reloads once to pick up the isolation headers. Safe to call repeatedly. */
export function reloadForIsolation(): void {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return;
    sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch {
    return;
  }
  location.reload();
}

/** Clears the guard once isolation is working, so a later session can retry. */
export function clearIsolationRetry(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
