/**
 * The edit script.
 *
 * The reader's original bytes are never modified. Every change they make is
 * appended to a list, and the document they see is that list replayed from the
 * original. A cursor says how much of the list counts right now, so undo is
 * `cursor - 1` and redo is `cursor + 1` — unlimited, and free, because nothing
 * has to be reversed.
 *
 * The property that makes this correct is that `stateAt` is a pure function of
 * the edits and the cursor. There is no accumulated state anywhere: arriving at
 * cursor 7 by going forwards, or by going to 20 and back, gives the same state
 * and therefore the same file. tests/studio.script.test.ts checks exactly that,
 * because the day it stops being true is the day undo starts lying.
 */

export type PageId = string;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Where a page's content comes from: the opened file, or something imported. */
export interface PageOrigin {
  /** `original` for the opened document, otherwise an imported asset's id. */
  asset: string;
  /** 0-based page index inside that document. */
  index: number;
}

export const ORIGINAL = 'original';

export interface PageState {
  id: PageId;
  origin: PageOrigin;
  /** Quarter turns clockwise on top of the page's own /Rotate, 0 to 3. */
  turns: number;
  /** Crop in the page's PDF user space, or null to keep its own box. */
  crop: Rect | null;
}

export type Mark =
  | {
      kind: 'text';
      id: string;
      page: PageId;
      /** Baseline start, in the page's PDF user space. */
      x: number;
      y: number;
      text: string;
      size: number;
      color: Rgb;
      /** Degrees counter-clockwise in PDF user space, so it turns with the page. */
      rotate: number;
      font: { family: 'helvetica' | 'times' | 'courier'; bold: boolean; italic: boolean };
    }
  | {
      kind: 'rect';
      id: string;
      page: PageId;
      x: number;
      y: number;
      width: number;
      height: number;
      color: Rgb | null;
      borderColor: Rgb | null;
      borderWidth: number;
      opacity: number;
    }
  | {
      kind: 'image';
      id: string;
      page: PageId;
      /** Id of an imported asset holding PNG or JPEG bytes. */
      asset: string;
      x: number;
      y: number;
      width: number;
      height: number;
      opacity: number;
    }
  | {
      kind: 'ink';
      id: string;
      page: PageId;
      /** A polyline in the page's PDF user space: [[x, y], …]. */
      points: ReadonlyArray<readonly [number, number]>;
      color: Rgb;
      width: number;
    };

export type Edit =
  | { kind: 'rotate'; page: PageId; turns: number }
  | { kind: 'delete'; page: PageId }
  | { kind: 'move'; page: PageId; toIndex: number }
  | { kind: 'crop'; page: PageId; box: Rect | null }
  | { kind: 'insert'; at: number; asset: string; indices: readonly number[] }
  | { kind: 'draw'; mark: Mark }
  | { kind: 'erase'; markId: string };

export interface ScriptState {
  pages: PageState[];
  marks: Mark[];
}

/** The id an original page carries for the whole session. */
export function originalPageId(index: number): PageId {
  return `o${index}`;
}

/** The id an imported page carries; stable for a given asset, index and insertion. */
export function importedPageId(asset: string, index: number, seq: number): PageId {
  return `i${seq}:${asset}:${index}`;
}

export function initialState(pageCount: number): ScriptState {
  return {
    pages: Array.from({ length: pageCount }, (_, index) => ({
      id: originalPageId(index),
      origin: { asset: ORIGINAL, index },
      turns: 0,
      crop: null,
    })),
    marks: [],
  };
}

function withPage(
  state: ScriptState,
  id: PageId,
  change: (page: PageState) => PageState
): ScriptState {
  let touched = false;
  const pages = state.pages.map((page) => {
    if (page.id !== id) return page;
    touched = true;
    return change(page);
  });
  // An edit naming a page that is already gone is a no-op rather than a crash:
  // a stale button in the interface must not be able to break the script.
  return touched ? { ...state, pages } : state;
}

/**
 * Applies one edit. Never mutates its input — replaying the same list twice has
 * to give the same answer both times.
 */
export function reduce(state: ScriptState, edit: Edit, seq: number): ScriptState {
  switch (edit.kind) {
    case 'rotate':
      return withPage(state, edit.page, (page) => ({
        ...page,
        turns: (((page.turns + edit.turns) % 4) + 4) % 4,
      }));

    case 'crop':
      return withPage(state, edit.page, (page) => ({ ...page, crop: edit.box }));

    case 'delete': {
      const pages = state.pages.filter((page) => page.id !== edit.page);
      if (pages.length === state.pages.length) return state;
      // The last page cannot be deleted: a document with no pages is not a
      // document, and pdf-lib cannot save one.
      if (pages.length === 0) return state;
      return {
        pages,
        // Marks on a deleted page go with it, so undoing the delete brings both
        // back and the script stays a pure replay.
        marks: state.marks.filter((mark) => mark.page !== edit.page),
      };
    }

    case 'move': {
      const from = state.pages.findIndex((page) => page.id === edit.page);
      if (from === -1) return state;
      const to = Math.min(Math.max(edit.toIndex, 0), state.pages.length - 1);
      if (from === to) return state;
      const pages = [...state.pages];
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      return { ...state, pages };
    }

    case 'insert': {
      const at = Math.min(Math.max(edit.at, 0), state.pages.length);
      const added: PageState[] = edit.indices.map((index) => ({
        id: importedPageId(edit.asset, index, seq),
        origin: { asset: edit.asset, index },
        turns: 0,
        crop: null,
      }));
      if (added.length === 0) return state;
      const pages = [...state.pages];
      pages.splice(at, 0, ...added);
      return { ...state, pages };
    }

    case 'draw': {
      // A mark on a page that no longer exists would be unreachable and would
      // silently disappear at materialise time; drop it here instead.
      if (!state.pages.some((page) => page.id === edit.mark.page)) return state;
      return { ...state, marks: [...state.marks, edit.mark] };
    }

    case 'erase': {
      const marks = state.marks.filter((mark) => mark.id !== edit.markId);
      return marks.length === state.marks.length ? state : { ...state, marks };
    }

    default:
      return state;
  }
}

/**
 * The document as it stands after the first `cursor` edits.
 *
 * Replayed from scratch every time, on purpose. The list is short — a person
 * makes tens of edits, not millions — and paying for a replay buys the
 * guarantee that the state depends on nothing but the inputs.
 */
export function stateAt(
  pageCount: number,
  edits: readonly Edit[],
  cursor: number
): ScriptState {
  const upTo = Math.min(Math.max(cursor, 0), edits.length);
  let state = initialState(pageCount);
  for (let index = 0; index < upTo; index += 1) {
    state = reduce(state, edits[index], index);
  }
  return state;
}

/**
 * True when the state asks for nothing at all: the original pages, in their
 * original order, unrotated, uncropped and unmarked.
 *
 * This is what lets an untouched document — or one whose edits have all been
 * undone — come back out as the very bytes that went in, rather than as a
 * re-encoded copy that merely looks the same.
 */
export function isUntouched(state: ScriptState, pageCount: number): boolean {
  if (state.marks.length > 0) return false;
  if (state.pages.length !== pageCount) return false;
  return state.pages.every(
    (page, index) =>
      page.origin.asset === ORIGINAL &&
      page.origin.index === index &&
      page.turns === 0 &&
      page.crop === null
  );
}

/** Appending an edit truncates whatever had been undone, as every editor does. */
export function append(
  edits: readonly Edit[],
  cursor: number,
  edit: Edit
): { edits: Edit[]; cursor: number } {
  const kept = edits.slice(0, Math.min(Math.max(cursor, 0), edits.length));
  return { edits: [...kept, edit], cursor: kept.length + 1 };
}
