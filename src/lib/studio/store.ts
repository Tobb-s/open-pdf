import type { Edit } from '@/lib/studio/script';

const embeddedFontAsset = (font: unknown): string | null => {
  if (!font || typeof font !== 'object') return null;
  const candidate = font as { kind?: unknown; asset?: unknown };
  return candidate.kind === 'embedded' && typeof candidate.asset === 'string' ? candidate.asset : null;
};

/**
 * The session, kept in IndexedDB so closing the tab is not the same as losing
 * the afternoon.
 *
 * What is stored is the original bytes plus the edit list — never a
 * materialised document. That is the same thing the editor holds in memory, so
 * reopening is exactly resuming, and a saved session cannot drift away from
 * what the editor would have produced.
 *
 * It stays on this device. Nothing here is sent anywhere, which is the whole
 * premise of the site, and it is why the only way to clear it is from this
 * browser.
 */

const DATABASE = 'openpdf-studio';
const STORE = 'session';
const VERSION = 1;

/**
 * The session is two records, not one, and the reason is a measurement.
 *
 * It used to be a single object holding the original bytes AND the edit list,
 * rewritten in full every time anything changed. On a 169 MB book — measured
 * in Chrome, with incompressible bytes — that was 137–166 ms and 185 MB of
 * disk written after every burst of editing, for an edit list of a few hundred
 * bytes. It did not block the main thread, so nothing looked wrong; it was
 * simply a document's worth of disk written per rotation of a page.
 *
 * The document goes in once, when the session begins. Everything that actually
 * changes goes in `SCRIPT_KEY`, where the same write costs about a millisecond.
 */
const ORIGINAL_KEY = 'original';
const SCRIPT_KEY = 'script';
/** The single record written by versions before the split, still readable. */
const LEGACY_KEY = 'current';

/**
 * The shape of an edit list.
 *
 * Bumped whenever `Edit` changes in a way an older list cannot be replayed
 * through — positions moved from indices to page ids, for instance. A session
 * from a different shape is discarded rather than replayed into something the
 * reader never asked for.
 */
export const SESSION_SHAPE = 2;

export interface StoredSession {
  /** The `SESSION_SHAPE` this list was written under. */
  shape?: number;
  name: string;
  original: Uint8Array;
  edits: Edit[];
  cursor: number;
  /** Imported PDFs and images, by asset id. */
  assets: Record<string, Uint8Array>;
  /** Milliseconds since the epoch, taken when the session was written. */
  savedAt: number;
}

/** The half that is written once: the document as it was opened. */
interface StoredOriginal {
  name: string;
  original: Uint8Array;
}

/** The half that is written on every change. */
interface StoredScript {
  shape?: number;
  edits: Edit[];
  cursor: number;
  assets: Record<string, Uint8Array>;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open.'));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        let result: T;

        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () =>
          reject(request.error ?? new Error('IndexedDB refused the request.'));

        // Settled on the TRANSACTION, not on the request. A request can succeed
        // and the transaction still abort at commit time — over quota, for
        // instance — and resolving on the request would report that as a save
        // that happened.
        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error('IndexedDB aborted the transaction.'));
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error('IndexedDB refused the write.'));
        };
      })
  );
}

/**
 * Every failure here is swallowed on purpose.
 *
 * Private browsing, a full disk and a browser with storage switched off all
 * make IndexedDB throw, and none of them is a reason to interrupt someone who
 * is editing a document. The session is a convenience; the document in memory
 * is the work.
 */
/**
 * Writes the document. Called once, when a session begins.
 *
 * It also clears whatever script was stored for the previous document: a new
 * original with an old edit list would replay somebody else's afternoon onto
 * this file.
 */
export async function saveOriginal(name: string, original: Uint8Array): Promise<boolean> {
  try {
    await run('readwrite', (store) => {
      store.delete(SCRIPT_KEY);
      store.delete(LEGACY_KEY);
      return store.put({ name, original } satisfies StoredOriginal, ORIGINAL_KEY);
    });
    return true;
  } catch {
    return false;
  }
}

/** Writes the edit list and the imported assets. Called on every change. */
export async function saveScript(script: StoredScript): Promise<boolean> {
  try {
    await run('readwrite', (store) => store.put(script, SCRIPT_KEY));
    return true;
  } catch {
    return false;
  }
}

/**
 * The assets an edit list still refers to.
 *
 * Anything not named here belonged to an edit that was truncated away, and
 * carrying it would grow the saved session for bytes the document can no longer
 * reach. The whole list is scanned rather than the part before the cursor, so
 * redo still works after a resume.
 *
 * The `switch` is exhaustive on purpose. This filter has now been wrong twice —
 * first for `insertImages`, whose pages came back blank, then for `raster`,
 * which silently brought a redacted page back UN-redacted — and both times
 * because a new kind of edit that carries bytes was added and this list was not
 *. The `never` below makes that a compile error instead of a defect nobody
 * sees until a document is already out the door.
 */
export function assetsReferencedBy(edits: readonly Edit[]): Set<string> {
  const referenced = new Set<string>();

  for (const edit of edits) {
    switch (edit.kind) {
      case 'insert':
        referenced.add(edit.asset);
        break;

      // Plural, and easy to forget: an image page's bytes live here and nowhere
      // else, so missing this deleted them on the next save.
      case 'insertImages':
        for (const asset of edit.assets) referenced.add(asset);
        break;

      case 'draw':
        if (edit.mark.kind === 'image' || edit.mark.kind === 'signature') {
          referenced.add(edit.mark.asset);
        }
        if (edit.mark.kind === 'text') {
          const asset = embeddedFontAsset(edit.mark.font);
          if (asset) referenced.add(asset);
        }
        break;

      case 'replaceMark':
        if (edit.mark.kind === 'image' || edit.mark.kind === 'signature') {
          referenced.add(edit.mark.asset);
        }
        if (edit.mark.kind === 'text') {
          const asset = embeddedFontAsset(edit.mark.font);
          if (asset) referenced.add(asset);
        }
        break;

      // The bitmap a redacted page was replaced by. Without it the rebuild
      // falls back to the original page, and for a scanned page — the ordinary
      // case for redaction — there is no text under the box for the export
      // check to look for, so it would report the file clean and hand over the
      // untouched scan.
      case 'raster':
        if (edit.raster) referenced.add(edit.raster.asset);
        break;

      case 'replaceText':
        referenced.add(edit.raster.asset);
        {
          const asset = embeddedFontAsset(edit.replacement.font);
          if (asset) referenced.add(asset);
        }
        break;

      case 'rewritePages':
        for (const page of edit.pages) {
          referenced.add(page.raster.asset);
          for (const mark of page.marks) {
            if (mark.kind === 'image' || mark.kind === 'signature') referenced.add(mark.asset);
            if (mark.kind === 'text') {
              const asset = embeddedFontAsset(mark.font);
              if (asset) referenced.add(asset);
            }
          }
        }
        break;

      case 'rotate':
      case 'delete':
      case 'move':
      case 'crop':
      case 'erase':
      case 'setField':
      case 'metadata':
      case 'watermark':
      case 'numbering':
      case 'flattenForms':
      case 'sanitize':
        break;

      default: {
        // If this stops compiling, a new Edit kind was added: decide whether it
        // carries bytes before adding it to the list above.
        const exhaustive: never = edit;
        void exhaustive;
      }
    }
  }

  return referenced;
}

/**
 * Joins the two halves back into the one thing the editor resumes from.
 *
 * A session written before the split is read from its single record and
 * returned as it is: it is a document the reader left open, and losing it over
 * a storage layout would be the same as losing the afternoon.
 */
export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [document_, script, legacy] = await Promise.all([
      run<StoredOriginal | undefined>('readonly', (store) => store.get(ORIGINAL_KEY)),
      run<StoredScript | undefined>('readonly', (store) => store.get(SCRIPT_KEY)),
      run<StoredSession | undefined>('readonly', (store) => store.get(LEGACY_KEY)),
    ]);

    const joined: StoredSession | null =
      document_?.original && script && Array.isArray(script.edits)
        ? {
            shape: script.shape,
            name: document_.name,
            original: document_.original,
            edits: script.edits,
            cursor: script.cursor,
            assets: script.assets ?? {},
            savedAt: script.savedAt,
          }
        : legacy?.original && Array.isArray(legacy.edits)
          ? legacy
          : null;

    if (!joined) return null;

    // An older shape cannot be replayed faithfully, and replaying it anyway
    // would quietly produce a document nobody asked for.
    if (joined.shape !== SESSION_SHAPE) {
      await clearSession();
      return null;
    }
    return joined;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run('readwrite', (store) => {
      store.delete(ORIGINAL_KEY);
      store.delete(SCRIPT_KEY);
      return store.delete(LEGACY_KEY);
    });
  } catch {
    // nothing to do: see above
  }
}
