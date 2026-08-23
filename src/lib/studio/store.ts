import type { Edit } from '@/lib/studio/script';

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
const KEY = 'current';
const VERSION = 1;

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
export async function saveSession(session: StoredSession): Promise<boolean> {
  try {
    await run('readwrite', (store) => store.put(session, KEY));
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
        if (edit.mark.kind === 'image') referenced.add(edit.mark.asset);
        break;

      // The bitmap a redacted page was replaced by. Without it the rebuild
      // falls back to the original page, and for a scanned page — the ordinary
      // case for redaction — there is no text under the box for the export
      // check to look for, so it would report the file clean and hand over the
      // untouched scan.
      case 'raster':
        if (edit.raster) referenced.add(edit.raster.asset);
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

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const stored = await run<StoredSession | undefined>('readonly', (store) => store.get(KEY));
    if (!stored || !stored.original || !Array.isArray(stored.edits)) return null;
    // An older shape cannot be replayed faithfully, and replaying it anyway
    // would quietly produce a document nobody asked for.
    if (stored.shape !== SESSION_SHAPE) {
      await clearSession();
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch {
    // nothing to do: see above
  }
}
