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

export interface ReviewReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

interface ReviewThread {
  author: string;
  body: string;
  createdAt: string;
  replies: readonly ReviewReply[];
}

/** Where a page's content comes from: the opened file, or something imported. */
export interface PageOrigin {
  /** `original` for the opened document, otherwise an imported asset's id. */
  asset: string;
  /** 0-based page index inside that document. */
  index: number;
}

export const ORIGINAL = 'original';

/**
 * A page that has been replaced by a picture of itself.
 *
 * This is how redaction is done, and it is the only way it can be done with a
 * library that cannot rewrite a content stream: the region is painted out on
 * the bitmap, and the bitmap becomes the page. What was underneath is not
 * covered — it is not in the file. `boxes` records what was painted out so the
 * export can go looking for it afterwards and refuse to hand over a file where
 * it survived.
 *
 * An empty `boxes` is the same operation with nothing painted out: a page
 * turned into an image so it can be drawn on without touching the original.
 */
/**
 * A region painted over before the page became a picture.
 *
 * `fill` is what separates redacting from erasing, and it is only the colour:
 * both rebuild the page as a bitmap that never held the content, so both really
 * remove it and both are checked the same way at export. Black says «something
 * was here»; white says nothing, which is what an eraser is for.
 *
 * Optional so a session written before erasing existed still replays: a box
 * with no colour is a redaction, which is all there was.
 */
export interface PaintedBox extends Rect {
  fill?: 'black' | 'white';
}

export interface PageRaster {
  /** The asset holding the rendered, already-painted-out bitmap. */
  asset: string;
  /** The painted regions, in the page's PDF user space. */
  boxes: readonly PaintedBox[];
  /** Exact visible terms intentionally removed, retained for the export proof. */
  redactedWords?: readonly string[];
}

export interface PageState {
  id: PageId;
  origin: PageOrigin;
  /** Quarter turns clockwise on top of the page's own /Rotate, 0 to 3. */
  turns: number;
  /** Crop in the page's PDF user space, or null to keep its own box. */
  crop: Rect | null;
  /** Set once the page has been rasterised, whether to redact or to flatten it. */
  raster: PageRaster | null;
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
      font: TextFont;
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
      /** A visible electronic signature, deliberately not a certificate signature. */
      kind: 'signature';
      id: string;
      page: PageId;
      asset: string;
      x: number;
      y: number;
      width: number;
      height: number;
      signer: string;
      reason: string;
      signedAt: string;
      /** Local calendar date shown beside the signature. */
      signedOn: string;
      method: 'typed' | 'drawn' | 'image';
    }
  | {
      /**
       * A layer of invisible text over a scanned page, so the words can be
       * found and selected. Modelled as a mark rather than as a document
       * setting because that is what it is: content that belongs to one page,
       * turns when the page turns, and goes when the page goes.
       */
      kind: 'ocr';
      id: string;
      page: PageId;
      /** Degrees counter-clockwise in PDF user space, so it turns with the page. */
      rotate: number;
      words: ReadonlyArray<{ text: string; x: number; y: number; size: number }>;
    }
  | {
      /** Searchable text rebuilt after a page is flattened for text replacement. */
      kind: 'textLayer';
      id: string;
      page: PageId;
      words: ReadonlyArray<{
        text: string;
        x: number;
        y: number;
        size: number;
        rotate: number;
      }>;
    }
  | {
      kind: 'ink';
      id: string;
      page: PageId;
      /** A polyline in the page's PDF user space: [[x, y], …]. */
      points: ReadonlyArray<readonly [number, number]>;
      color: Rgb;
      width: number;
    }
  | (ReviewThread & {
      kind: 'highlight' | 'underline' | 'strikeout';
      id: string;
      page: PageId;
      x: number;
      y: number;
      width: number;
      height: number;
      color: Rgb;
      opacity: number;
    })
  | {
      /**
       * A straight line, optionally with an arrowhead at its end.
       *
       * Kept as two points rather than as a normalised box because direction is
       * the whole content of an arrow: a rectangle would lose which end it
       * points at.
       */
      kind: 'line';
      id: string;
      page: PageId;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: Rgb;
      width: number;
      arrow: boolean;
    }
  | {
      /** An ellipse given by its centre and its two radii. */
      kind: 'ellipse';
      id: string;
      page: PageId;
      x: number;
      y: number;
      rx: number;
      ry: number;
      color: Rgb | null;
      borderColor: Rgb | null;
      borderWidth: number;
      opacity: number;
    }
  | (ReviewThread & {
      kind: 'comment';
      id: string;
      page: PageId;
      x: number;
      y: number;
      color: Rgb;
    });

/**
 * Positions are given as "immediately before this page", never as an index.
 *
 * The editor shows a document that trails the script while a rebuild is in
 * flight, so an index the reader picked from the screen describes a list that
 * may already have changed underneath it. Measured before this: deleting a page
 * and then importing a PDF "here" within the same settle window put the import
 * on the wrong side of the page the reader was looking at. A page id means the
 * same page whatever else moved.
 *
 * `before: null` means the end of the document.
 */
/** What a font looks like, mirroring the one the stamp tools already use. */
export interface FontChoice {
  family: 'helvetica' | 'times' | 'courier';
  bold: boolean;
  italic: boolean;
}

/**
 * A font recovered from the opened PDF. The bytes live in Studio's local asset
 * store so undo, redo and a resumed browser session always use the same face.
 */
export interface EmbeddedTextFont {
  kind: 'embedded';
  asset: string;
  name: string;
  /** Standard face selected as the visible alternative in Studio. */
  fallback: FontChoice;
}

export type TextFont = FontChoice | EmbeddedTextFont;

export type Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * A watermark and page numbers are document settings, not marks.
 *
 * One instruction rather than one mark per page: changing the text is a single
 * edit, a page added later is covered without asking, and — the reason it has
 * to be this way — the numbers are worked out from the FINAL order, so
 * reordering pages renumbers them instead of leaving the old numbers behind.
 *
 * `pages: null` means every page.
 */
export interface WatermarkSpec {
  text: string;
  font: FontChoice;
  size: number;
  color: Rgb;
  opacity: number;
  angle: number;
  anchor: Anchor;
  margin: number;
  pages: readonly PageId[] | null;
}

export interface NumberingSpec {
  font: FontChoice;
  size: number;
  color: Rgb;
  anchor: Anchor;
  margin: number;
  startAt: number;
  format: 'plain' | 'ofTotal';
  /** The word between the two numbers, from the dictionary. */
  ofWord: string;
  pages: readonly PageId[] | null;
}

export interface Metadata {
  title?: string;
  author?: string;
  language?: string;
}

/**
 * A change to the metadata. `null` means "stop asking for this one", which is
 * what returning a box to the document's own value has to mean — otherwise the
 * script could never say "unchanged" again, and an empty box would overwrite a
 * real title with nothing.
 */
export type MetadataPatch = { [K in keyof Metadata]?: string | null };

export interface SanitizationSpec {
  metadata: boolean;
  comments: boolean;
  attachments: boolean;
  actions: boolean;
}

export interface PageRewrite {
  page: PageId;
  raster: PageRaster;
  /** Marks that remain live after the visible page has been baked into the raster. */
  marks: readonly Mark[];
}

export type Edit =
  | { kind: 'rotate'; page: PageId; turns: number }
  | { kind: 'delete'; page: PageId }
  | { kind: 'move'; page: PageId; before: PageId | null }
  | { kind: 'crop'; page: PageId; box: Rect | null }
  | { kind: 'insert'; before: PageId | null; asset: string; indices: readonly number[] }
  | { kind: 'draw'; mark: Mark }
  | { kind: 'replaceMark'; mark: Mark }
  | { kind: 'erase'; markId: string }
  | { kind: 'insertImages'; before: PageId | null; assets: readonly string[] }
  | { kind: 'setField'; field: string; value: string }
  | { kind: 'metadata'; patch: MetadataPatch }
  | { kind: 'watermark'; spec: WatermarkSpec | null }
  | { kind: 'numbering'; spec: NumberingSpec | null }
  | { kind: 'raster'; page: PageId; raster: PageRaster | null }
  | {
      /** Flattens a page, replaces its marks, and writes new text in one undo step. */
      kind: 'replaceText';
      page: PageId;
      raster: PageRaster;
      replacement: Extract<Mark, { kind: 'text' }>;
      textLayer: Extract<Mark, { kind: 'textLayer' }>;
    }
  | { kind: 'rewritePages'; pages: readonly PageRewrite[] }
  | { kind: 'sanitize'; spec: SanitizationSpec | null }
  | { kind: 'flattenForms'; on: boolean };

export interface ScriptState {
  pages: PageState[];
  marks: Mark[];
  /** Turns the form's fields into fixed content: readable, no longer fillable. */
  flattenForms: boolean;
  /** Form field values the reader has set, by field name. */
  fields: Record<string, string>;
  metadata: Metadata;
  watermark: WatermarkSpec | null;
  numbering: NumberingSpec | null;
  sanitize: SanitizationSpec | null;
}

/** The id an original page carries for the whole session. */
export function originalPageId(index: number): PageId {
  return `o${index}`;
}

/** The id an imported page carries; stable for a given asset, index and insertion. */
export function importedPageId(asset: string, index: number, seq: number): PageId {
  return `i${seq}:${asset}:${index}`;
}

/** The id a page made from an imported image carries. */
export function imagePageId(asset: string, seq: number): PageId {
  return `g${seq}:${asset}`;
}

/** An image becomes a page whose longest side is this many points. */
export const IMAGE_PAGE_LONG_SIDE = 842;

export function initialState(pageCount: number): ScriptState {
  return {
    pages: Array.from({ length: pageCount }, (_, index) => ({
      id: originalPageId(index),
      origin: { asset: ORIGINAL, index },
      turns: 0,
      crop: null,
      raster: null,
    })),
    marks: [],
    flattenForms: false,
    fields: {},
    metadata: {},
    watermark: null,
    numbering: null,
    sanitize: null,
  };
}

/**
 * Where "before this page" lands in `pages`, or null when the anchor is gone.
 * A null anchor means the end of the document, which always exists.
 */
function insertionPoint(pages: readonly PageState[], before: PageId | null): number | null {
  if (before === null) return pages.length;
  const at = pages.findIndex((page) => page.id === before);
  return at === -1 ? null : at;
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
        ...state,
        pages,
        // Marks on a deleted page go with it, so undoing the delete brings both
        // back and the script stays a pure replay.
        marks: state.marks.filter((mark) => mark.page !== edit.page),
      };
    }

    case 'move': {
      const from = state.pages.findIndex((page) => page.id === edit.page);
      if (from === -1) return state;

      const pages = [...state.pages];
      const [moved] = pages.splice(from, 1);
      const at = insertionPoint(pages, edit.before);
      // The anchor is gone — deleted since the reader clicked. Leaving the page
      // where it was beats guessing at a position they did not choose.
      if (at === null) return state;
      pages.splice(at, 0, moved);
      return { ...state, pages };
    }

    case 'insert': {
      const added: PageState[] = edit.indices.map((index) => ({
        id: importedPageId(edit.asset, index, seq),
        origin: { asset: edit.asset, index },
        turns: 0,
        crop: null,
        raster: null,
      }));
      if (added.length === 0) return state;

      const at = insertionPoint(state.pages, edit.before);
      const pages = [...state.pages];
      // An anchor that no longer exists sends the pages to the end rather than
      // dropping them: the reader asked for them to be in the document.
      pages.splice(at ?? pages.length, 0, ...added);
      return { ...state, pages };
    }

    case 'draw': {
      // A mark on a page that no longer exists would be unreachable and would
      // silently disappear at materialise time; drop it here instead.
      if (!state.pages.some((page) => page.id === edit.mark.page)) return state;
      return { ...state, marks: [...state.marks, edit.mark] };
    }

    case 'replaceMark': {
      if (!state.pages.some((page) => page.id === edit.mark.page)) return state;
      let found = false;
      const marks = state.marks.map((mark) => {
        if (mark.id !== edit.mark.id) return mark;
        found = true;
        return edit.mark;
      });
      return found ? { ...state, marks } : state;
    }

    case 'erase': {
      const marks = state.marks.filter((mark) => mark.id !== edit.markId);
      return marks.length === state.marks.length ? state : { ...state, marks };
    }

    case 'insertImages': {
      const added: PageState[] = edit.assets.map((asset, offset) => ({
        id: imagePageId(asset, seq * 1000 + offset),
        origin: { asset, index: 0 },
        turns: 0,
        crop: null,
        raster: null,
      }));
      if (added.length === 0) return state;

      const at = insertionPoint(state.pages, edit.before);
      const pages = [...state.pages];
      pages.splice(at ?? pages.length, 0, ...added);
      return { ...state, pages };
    }

    case 'setField':
      return { ...state, fields: { ...state.fields, [edit.field]: edit.value } };

    case 'metadata': {
      const metadata: Metadata = { ...state.metadata };
      for (const [key, value] of Object.entries(edit.patch)) {
        if (value === null) delete metadata[key as keyof Metadata];
        else metadata[key as keyof Metadata] = value;
      }
      return { ...state, metadata };
    }

    case 'watermark':
      return { ...state, watermark: edit.spec };

    case 'numbering':
      return { ...state, numbering: edit.spec };

    case 'raster':
      return withPage(state, edit.page, (page) => ({ ...page, raster: edit.raster }));

    case 'replaceText': {
      if (!state.pages.some((page) => page.id === edit.page)) return state;
      const pages = state.pages.map((page) =>
        page.id === edit.page ? { ...page, raster: edit.raster } : page
      );
      // Every visible mark on this page is already baked into the new bitmap.
      // Keeping it would draw it a second time. Only the new visible text and
      // the rebuilt search layer remain as live content.
      const marks = state.marks
        .filter((mark) => mark.page !== edit.page)
        .concat(edit.textLayer, edit.replacement);
      return { ...state, pages, marks };
    }

    case 'rewritePages': {
      const available = new Set(state.pages.map((page) => page.id));
      const rewrites = new Map(edit.pages.filter((entry) => available.has(entry.page)).map((entry) => [entry.page, entry]));
      if (rewrites.size === 0) return state;
      const pages = state.pages.map((page) => {
        const rewrite = rewrites.get(page.id);
        return rewrite ? { ...page, raster: rewrite.raster } : page;
      });
      const marks = state.marks
        .filter((mark) => !rewrites.has(mark.page))
        .concat(...[...rewrites.values()].map((entry) => [...entry.marks]));
      return { ...state, pages, marks };
    }

    case 'sanitize':
      return { ...state, sanitize: edit.spec };

    case 'flattenForms':
      return { ...state, flattenForms: edit.on };

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
  if (Object.keys(state.fields).length > 0) return false;
  if (Object.keys(state.metadata).length > 0) return false;
  if (state.watermark !== null || state.numbering !== null) return false;
  if (state.sanitize !== null) return false;
  if (state.flattenForms) return false;
  return state.pages.every(
    (page, index) =>
      page.origin.asset === ORIGINAL &&
      page.origin.index === index &&
      page.turns === 0 &&
      page.crop === null &&
      page.raster === null
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
