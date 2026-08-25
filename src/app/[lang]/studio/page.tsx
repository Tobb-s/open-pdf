'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import PageStrip from '@/components/studio/PageStrip';
import Stage, { type StageAction, type StageTool } from '@/components/studio/Stage';
import { isEditableTarget, shortcutFor, TOOL_ORDER } from '@/lib/studio/shortcuts';
import DocumentPanel from '@/components/studio/DocumentPanel';
import { readDocumentFacts, type FormFieldInfo } from '@/lib/studio/facts';
import { ColorRow, Field, NumberRow } from '@/components/StampControls';
import {
  Crop,
  Download,
  EyeOff,
  FilePlus2,
  FileText,
  Hand,
  Highlighter,
  Image as ImageIcon,
  ImageUp,
  Loader2,
  Pen,
  Redo2,
  Send,
  MessageSquareText,
  Square,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { fitWithin, pdfToViewportPoint, uprightTextRotation, visualToPdfPoint } from '@/lib/geometry';
import { assertFileSize, MAX_EDITABLE_BYTES } from '@/lib/limits';
import { openPdf, renderPageToJpeg } from '@/lib/pdfjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractOcrWords, fitFontSize, RECOGNIZE_OUTPUT, toWinAnsi } from '@/lib/ocr';
import { hexToRgb, imageKind, UnsupportedCharacterError } from '@/lib/stamp';
import { createStudioEngine, type StudioEngine } from '@/lib/studio/engine';
import {
  append,
  ORIGINAL,
  stateAt,
  type Edit,
  type Mark,
  type Metadata,
  type MetadataPatch,
  type Rect,
  type NumberingSpec,
  type ScriptState,
  type WatermarkSpec,
} from '@/lib/studio/script';
import { importedStructures, type FieldCheck } from '@/lib/studio/verify';
import {
  allTextIn,
  insideAny,
  judgeRedaction,
  redactedPages,
  type RedactionVerdict,
  type RedactionTarget,
} from '@/lib/studio/redaction';
import {
  assetsReferencedBy,
  clearSession,
  loadSession,
  saveOriginal,
  saveScript,
  SESSION_SHAPE,
  type StoredSession,
} from '@/lib/studio/store';
import {
  diffStructures,
  VERIFIABLE_CATEGORIES,
  type StructuralReport,
} from '@/lib/verify/structural';

/** How long after the last change the document is rebuilt. */
const SETTLE_MS = 450;
/**
 * Above this, rebuilding is slow enough that doing it after every keystroke
 * would fight the reader instead of helping them, so the view goes manual.
 * Chosen from the plan's own budget: a rebuild was meant to cost 100–200 ms.
 */
const SLOW_MS = 1500;
/**
 * How finely a page is redrawn when it becomes a picture. Two is the same scale
 * the OCR path uses — enough that text stays comfortably readable, and not so
 * much that a long document turns into a pile of huge bitmaps.
 */
const RASTER_SCALE = 2;
/** The square, in points, a placed image is fitted inside. */
const IMAGE_STAMP_BOX = 140;

type ReviewMark = Extract<
  Mark,
  { kind: 'highlight' | 'underline' | 'strikeout' | 'comment' }
>;

const isReviewTool = (tool: StageTool): boolean =>
  tool === 'highlight' ||
  tool === 'underline' ||
  tool === 'strikeout' ||
  tool === 'comment';

const isReviewMark = (mark: Mark): mark is ReviewMark => isReviewTool(mark.kind as StageTool);

/**
 * Looks for the redacted words in the file that is about to be handed over.
 *
 * The words are re-derived rather than remembered: the document is rebuilt once
 * WITHOUT its pictures, the text inside each painted region is read off that,
 * and then every word of the produced file is searched for it. Re-deriving is
 * what makes this work on a session resumed a day later, and it means the check
 * is against what the page actually said rather than against a note we kept.
 */
async function findSurvivors(
  engine: StudioEngine,
  state: ScriptState,
  painted: ReturnType<typeof redactedPages>,
  produced: Uint8Array
): Promise<RedactionVerdict> {
  const targets: RedactionTarget[] = [];

  const bare: ScriptState = {
    ...state,
    pages: state.pages.map((page) => ({ ...page, raster: null })),
  };
  const { bytes, placed } = await engine.render(bare);
  const source = await openPdf(bytes);
  try {
    for (const entry of painted) {
      // From what the build produced, not from what it was asked to produce.
      // A page the build had to skip shifts every page after it, and this
      // lookup would then take the text of a DIFFERENT page, find none of the
      // painted words in it, and report the document clean — a check that
      // cannot fail, which is worse than no check at all.
      const at = placed.indexOf(entry.page);
      if (at === -1) continue;
      const page = await source.document.getPage(at + 1);
      const content = await page.getTextContent();
      const words: string[] = [];
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const [, , , , x, y] = item.transform;
        const box = { x, y, width: item.width ?? 0, height: item.height ?? 0 };
        if (insideAny(box, entry.boxes)) words.push(item.str);
      }
      page.cleanup();
      targets.push({ page: entry.page, words });
    }
  } finally {
    await source.destroy().catch(() => {});
  }

  const opened = await openPdf(produced);
  try {
    let all = '';
    for (let number = 1; number <= opened.document.numPages; number += 1) {
      const page = await opened.document.getPage(number);
      const content = await page.getTextContent();
      all += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + ' ';
      page.cleanup();
    }

    // Everything else the file carries. Page text is only what a viewer DRAWS,
    // and a name can outlive a redaction somewhere nothing draws it: the title,
    // the XMP block, a bookmark, a comment on another page, the filename of an
    // attachment, a form value whose widget went with its page. `materialize`
    // edits the original document in place rather than rebuilding it from
    // copied pages — deliberately, because rebuilding destroys the form and the
    // bookmarks — so all of those survive by default.
    try {
      const { loadPdf } = await import('@/lib/pdfio');
      const produced_ = await loadPdf(produced, { updateMetadata: false });
      all += ' ' + allTextIn(produced_);
    } catch {
      // A document pdf-lib will not open is judged on its page text alone. The
      // export's own error path handles a file that cannot be read at all.
    }

    return judgeRedaction(targets, all);
  } finally {
    await opened.destroy().catch(() => {});
  }
}

/**
 * A materialised document, together with the script state it came from.
 *
 * They travel as one on purpose. The rail, the page count and a click on the
 * canvas all describe what is ON SCREEN, and the screen is always a step behind
 * the script while a rebuild is in flight. Resolving any of them against the
 * live state instead would mean the reader marks one page and another one
 * changes.
 */
type Built = {
  document: PDFDocumentProxy;
  destroy: () => Promise<void>;
  state: ScriptState;
  /**
   * The ids really in `document`, in its own order.
   *
   * Not `state.pages`. A page whose image will not embed is skipped by the
   * build rather than allowed to kill it, and every index the editor holds is
   * one out of step from that page onward: the reader draws on a page they are
   * not looking at, and the export's redaction check reads the text of the
   * wrong page and reports the document clean without having looked at what was
   * painted out.
   */
  placed: string[];
};

/**
 * Ids for marks and imported assets.
 *
 * Random rather than counted: a counter restarts at zero when the tab reloads,
 * and a resumed session brings back edits that still carry the ids the old
 * counter minted — so the first new mark would be handed the id of a restored
 * one, and erasing either would erase both.
 */
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function StudioPage() {
  const { locale, t } = useI18n();

  const [name, setName] = useState('');
  const [original, setOriginal] = useState<Uint8Array | null>(null);
  const [originalPages, setOriginalPages] = useState(0);
  /**
   * The list and the cursor as ONE value.
   *
   * They were two, updated from two setState calls, and a caller that appended
   * twice in one batch truncated the list against a cursor that was a render
   * behind — dropping the first edit while the cursor advanced past the end.
   * Held together, a single updater decides both and they cannot disagree.
   */
  const [script, setScript] = useState<{ edits: Edit[]; cursor: number }>({
    edits: [],
    cursor: 0,
  });
  const { edits, cursor } = script;
  const [assets, setAssets] = useState<Record<string, Uint8Array>>({});

  const [built, setBuilt] = useState<Built | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [tool, setTool] = useState<StageTool>('pick');
  const [building, setBuilding] = useState(false);
  const [live, setLive] = useState(true);
  const [slowBecause, setSlowBecause] = useState<number | null>(null);
  const [nudge, setNudge] = useState(0);
  const [offMainThread, setOffMainThread] = useState(true);

  const [textValue, setTextValue] = useState('');
  const [textSize, setTextSize] = useState(14);
  const [inkWidth, setInkWidth] = useState(2);
  const [color, setColor] = useState('#c62828');
  const [toolMode, setToolMode] = useState<'edit' | 'review'>('edit');
  const [reviewColor, setReviewColor] = useState('#f4c542');
  const [reviewAuthor, setReviewAuthor] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  /** The image waiting to be placed, with its own shape so the stamp can keep it. */
  const [pendingImage, setPendingImage] = useState<{
    id: string;
    name: string;
    width: number;
    height: number;
  } | null>(null);

  /* -------------------------------------------------- the document panel -- */
  const [panel, setPanel] = useState<'page' | 'document'>('page');
  const [formFields, setFormFields] = useState<FormFieldInfo[]>([]);
  /** What the opened document already said, so the boxes are never blank by mistake. */
  const [originalMetadata, setOriginalMetadata] = useState<Metadata>({});
  /**
   * What each imported file could not bring with its pages, remembered against
   * the edit that brought it — so undoing the import takes the notice with it
   * rather than leaving a warning about pages that are no longer there.
   */
  const [importNotes, setImportNotes] = useState<
    Array<{ asset: string; name: string; lost: string[] }>
  >([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [rasterising, setRasterising] = useState(false);
  /** Set when an export was refused because redacted words survived. */
  const [blocked, setBlocked] = useState<string[] | null>(null);
  /** True when a redaction could not be checked because the page had no text. */
  const [unproven, setUnproven] = useState(false);
  /** True when the opened document carried a digital signature. */
  const [signed, setSigned] = useState(false);
  const [verifying, setVerifying] = useState(false);
  /**
   * How many words the last run found, and on which page. Kept together so the
   * count cannot follow the reader to a page it says nothing about.
   */
  const [ocrResult, setOcrResult] = useState<{ page: string; words: number } | null>(null);

  const [resumable, setResumable] = useState<StoredSession | null>(null);
  const [savedOk, setSavedOk] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{
    blob: Blob;
    pages: number;
    report: StructuralReport;
    /** Field values the produced file disagreed with, read back from it. */
    fields: FieldCheck[];
  } | null>(null);
  const [error, setError] = useState<ToolError | null>(null);

  const engineRef = useRef<StudioEngine | null>(null);
  /** Bumped per rebuild so a slow one cannot overwrite a newer result. */
  const generationRef = useRef(0);

  // Releasing the previous render's pdf.js document: the cleanup runs with the
  // value that is being replaced, which is precisely the one to let go of.
  useEffect(() => () => void built?.destroy().catch(() => {}), [built]);

  const state: ScriptState = useMemo(
    () => stateAt(originalPages, edits, cursor),
    [originalPages, edits, cursor]
  );

  /** What is on screen right now, which trails the script during a rebuild. */
  const view = built?.state ?? null;

  /**
   * The pages the drawn document actually holds, in its order.
   *
   * Taken from the build's report rather than from the script it was built
   * from, so an index into this list and a page in that document can never
   * disagree. When they agreed by construction, they still disagreed whenever
   * the build had to skip something.
   */
  const viewPages = useMemo(() => {
    if (!built) return [];
    const byId = new Map(built.state.pages.map((page) => [page.id, page]));
    return built.placed
      .map((id) => byId.get(id))
      .filter((page): page is NonNullable<typeof page> => page !== undefined);
  }, [built]);

  /** The ids in display order, for anything that speaks page numbers to the reader. */
  const viewPageIds = useMemo(() => viewPages.map((page) => page.id), [viewPages]);


  /** Pages the script asked for that the build could not produce. */
  const dropped = useMemo(() => {
    if (!built) return 0;
    return Math.max(0, built.state.pages.length - viewPages.length);
  }, [built, viewPages]);

  /**
   * Only the notices whose import is still part of the document. Undo the
   * import and the warning goes with it.
   */
  const visibleImportNotes = useMemo(() => {
    const live = new Set(
      state.pages.map((page) => page.origin.asset).filter((asset) => asset !== ORIGINAL)
    );
    return importNotes.filter((note) => live.has(note.asset));
  }, [importNotes, state]);

  /* ------------------------------------------------ engine and resume ---- */

  useEffect(() => {
    const engine = createStudioEngine();
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const stored = await loadSession();
      if (stored) setResumable(stored);
    })();
  }, []);

  /* ------------------------------------------------------ opening a file - */

  const beginSession = useCallback(
    async (
      fileName: string,
      bytes: Uint8Array,
      restored?: { edits: Edit[]; cursor: number; assets: Record<string, Uint8Array> }
    ) => {
      const engine = engineRef.current;
      if (!engine) return;

      const opened = await openPdf(bytes);
      const count = opened.document.numPages;
      await opened.destroy().catch(() => {});

      // The form as the document defines it. The reader's changes live in the
      // script; this is only what the fields started as.
      const opening = await readDocumentFacts(bytes);
      setFormFields(opening.fields);
      setOriginalMetadata(opening.metadata);
      setSigned(opening.signed);

      await engine.open(bytes);
      setOffMainThread(engine.offMainThread);
      const restoredAssets = restored?.assets ?? {};
      for (const [id, asset] of Object.entries(restoredAssets)) engine.putAsset(id, asset);

      setName(fileName);
      setOriginal(bytes);
      setOriginalPages(count);
      setScript({ edits: restored?.edits ?? [], cursor: restored?.cursor ?? 0 });
      setAssets(restoredAssets);
      setPageIndex(0);
      setTool('pick');
      setToolMode('edit');
      setPendingImage(null);
      setCommentBody('');
      setReplyDrafts({});
      setPanel('page');
      setImportNotes([]);
      setOcrResult(null);
      setResult(null);
      setResumable(null);
      setLive(true);
      setSlowBecause(null);
      // Nothing has been written for THIS document yet, whatever was true of
      // the last one.
      setSavedOk(null);

      // The document itself, written once. Everything after this is the edit
      // list, which is small — rewriting a 169 MB book after every rotation of
      // a page was 150 ms and 185 MB of disk, measured, for nothing.
      void saveOriginal(fileName, bytes).then((ok) => {
        if (!ok) setSavedOk(false);
      });
    },
    []
  );

  const selectFile = async (selected: File) => {
    try {
      assertFileSize(selected, t, MAX_EDITABLE_BYTES);
      const bytes = new Uint8Array(await selected.arrayBuffer());
      await beginSession(selected.name, bytes);
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  /* --------------------------------------------- the converging preview -- */

  /**
   * pdf-lib throws from inside drawText on a character the standard fonts
   * cannot encode, and that failure repeats on every rebuild until the mark is
   * undone. Saying which character it was turns a stuck editor into an
   * instruction.
   */
  const describeStudioError = useCallback(
    (caught: unknown): ToolError =>
      caught instanceof UnsupportedCharacterError
        ? {
            kind: 'invalid',
            title: t.studio.tools.text,
            detail: t.stamp.unsupportedCharacter(caught.character),
          }
        : describeError(caught, t),
    [t]
  );

  const rebuild = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !original) return;

    const generation = (generationRef.current += 1);
    setBuilding(true);
    try {
      const started = performance.now();
      const { bytes, placed, offMainThread: inWorker } = await engine.render(state);
      // Re-read every time: the engine can hand the job to the main thread part
      // way through a session, and the banner has to follow it.
      setOffMainThread(inWorker);
      const opened = await openPdf(bytes);

      // A rebuild that started earlier must never land on top of a newer one.
      // Without this, a slow render of an old state can be the last to arrive
      // and leave the screen showing a document nobody asked for.
      if (generation !== generationRef.current) {
        await opened.destroy().catch(() => {});
        return;
      }

      // The bytes are not kept: exporting re-renders from the script, so a copy
      // of every intermediate document would pin a document's worth of memory
      // for nothing.
      setBuilt({ document: opened.document, destroy: opened.destroy, state, placed });
      setPageIndex((index) => Math.min(index, opened.document.numPages - 1));

      // Measured from the request to the document being ready to draw. It does
      // not include the raster itself, which Stage does next, so it is a floor
      // on the wait rather than the whole of it.
      const elapsed = performance.now() - started;
      // The plan's designed way out: if this is slow, stop doing it on every
      // change and let the reader ask for it instead. The editor keeps working;
      // only the automatic refresh stops.
      if (elapsed > SLOW_MS) {
        setLive(false);
        // Frozen at the measurement that caused the switch: later rebuilds are
        // often faster, and quoting one of those as the reason would explain
        // the manual view with a number that never justified it.
        setSlowBecause((current) => current ?? elapsed);
      }
      setError(null);
    } catch (caught) {
      if (generation === generationRef.current) setError(describeStudioError(caught));
    } finally {
      if (generation === generationRef.current) setBuilding(false);
    }
  }, [original, state, describeStudioError]);

  useEffect(() => {
    if (!original || !live) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void rebuild();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [original, state, live, rebuild]);

  // Manual mode: rebuild only when the reader asks, however many changes they
  // piled up in between.
  useEffect(() => {
    if (nudge === 0) return;
    void rebuild();
    // Deliberately keyed on the button alone: adding `rebuild` here would make
    // a paused view refresh itself on every edit, which is the thing manual
    // mode exists to stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge]);

  /* --------------------------------------------------------- persistence - */

  useEffect(() => {
    if (!original) return;
    const timer = setTimeout(() => {
      void (async () => {
        // Which bytes the edit list still reaches. This lives in store.ts as a
        // pure, exhaustive function rather than inline here, because inline is
        // where it was wrong twice and where no test could reach it.
        const referenced = assetsReferencedBy(edits);
        const kept = Object.fromEntries(
          Object.entries(assets).filter(([id]) => referenced.has(id))
        );

        const ok = await saveScript({
          shape: SESSION_SHAPE,
          edits,
          cursor,
          assets: kept,
          savedAt: Date.now(),
        });
        setSavedOk(ok);
      })();
    }, 900);
    return () => clearTimeout(timer);
    // `name` and `original` are deliberately absent: they are written once,
    // when the session begins, and cannot change without a new session.
  }, [original, edits, cursor, assets]);

  /* ------------------------------------------------------------- editing - */

  /**
   * Every change goes through here. Appending truncates anything that had been
   * undone, which is what every editor does and what keeps the list a single
   * line of history rather than a tree.
   *
   * It reads the list through a functional update rather than from the closure,
   * because some callers get here after an await — importing a PDF has to parse
   * it first — and a closure captured before that wait would append against a
   * stale list and silently drop everything the reader did while they waited.
   * One updater returns both halves, so nothing can land between them.
   */
  const undo = useCallback(() => {
    setScript((current) => ({ ...current, cursor: Math.max(0, current.cursor - 1) }));
  }, []);

  const redo = useCallback(() => {
    setScript((current) => ({
      ...current,
      cursor: Math.min(current.edits.length, current.cursor + 1),
    }));
  }, []);

  /**
   * The keyboard. Ctrl+Z and the rest, routed through the pure mapping in
   * src/lib/studio/shortcuts.ts.
   *
   * Bound to the window rather than to a focused element, because the reader's
   * focus is usually the canvas, which takes none — and skipped the moment the
   * target is a text box, so a «2» typed into the title stays a 2 instead of
   * switching to the text tool. A shortcut that maps to something calls
   * preventDefault; one that does not is left to the browser, so Ctrl+Z inside
   * the title box still undoes the typing there.
   */
  const pageCountShown = viewPages.length;
  useEffect(() => {
    if (!original) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const shortcut = shortcutFor(event);
      if (!shortcut) return;

      switch (shortcut.kind) {
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'previousPage':
          setPageIndex((index) => Math.max(0, index - 1));
          break;
        case 'nextPage':
          setPageIndex((index) => Math.min(pageCountShown - 1, index + 1));
          break;
        case 'escape':
          setTool('pick');
          setToolMode('edit');
          break;
        case 'tool':
          // The image tool needs a chosen image first; without one it does
          // nothing, so the digit falls through to leave the tool as it was.
          if (shortcut.tool === 'image' && !pendingImage) break;
          setTool(shortcut.tool);
          setToolMode(isReviewTool(shortcut.tool) ? 'review' : 'edit');
          break;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [original, undo, redo, pendingImage, pageCountShown]);

  const addEdit = useCallback((edit: Edit) => {
    setScript((current) => append(current.edits, current.cursor, edit));
  }, []);

  const addReply = (mark: Extract<Mark, { kind: 'comment' }>) => {
    const body = replyDrafts[mark.id]?.trim() ?? '';
    if (body === '') return;
    addEdit({
      kind: 'replaceMark',
      mark: {
        ...mark,
        replies: [
          ...mark.replies,
          {
            id: newId(),
            author: reviewAuthor.trim() || t.studio.defaultReviewer,
            body,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    setReplyDrafts((current) => ({ ...current, [mark.id]: '' }));
  };

  /**
   * The id of the page the reader is looking at.
   *
   * Read from the state the visible document was built from, never from the
   * live script: while a rebuild is in flight those two disagree, and using the
   * live one would apply an edit to a page the reader cannot see.
   */
  const pageIdAt = useCallback(
    (index: number) => viewPages[index]?.id ?? null,
    [viewPages]
  );

  /**
   * What each page in the rail looks like, as a string. A thumbnail is redrawn
   * only when its own line here changes, so turning one page does not redraw
   * the whole document.
   *
   * Derived from the state the rail is actually showing. Taking it from the
   * live script instead would hand the cache a post-edit key for a pre-edit
   * bitmap — and because the cache never looks again once a key is filled, the
   * rail would keep that wrong picture for the rest of the session.
   */
  const signatures = useMemo(
    () =>
      (view?.pages ?? []).map((page) => {
        // The marks themselves, not how many there are. Erasing one mark and
        // drawing another inside the same settle window leaves the count
        // unchanged, and the rail would keep showing the one that is gone.
        const marks = (view?.marks ?? [])
          .filter((mark) => mark.page === page.id)
          .map((mark) => mark.id)
          .join(',');
        const crop = page.crop
          ? `${page.crop.x},${page.crop.y},${page.crop.width},${page.crop.height}`
          : '-';
        // The bitmap counts too. Without it a redaction changed nothing in this
        // string, the rail kept its cached thumbnail, and the page went on
        // showing the name the reader had just painted out — for the rest of
        // the session, or until some unrelated edit happened to move this page.
        const raster = page.raster ? page.raster.asset : '-';
        return `${page.id}:${page.turns}:${crop}:${raster}:${marks}`;
      }),
    [view]
  );

  const onStageAction = (action: StageAction, pageRotation: number) => {
    const page = pageIdAt(pageIndex);
    if (!page) return;
    const rgbColor = hexToRgb(color);
    const reviewRgb = hexToRgb(reviewColor);

    if (
      (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') &&
      action.kind === 'rect'
    ) {
      addEdit({
        kind: 'draw',
        mark: {
          kind: tool,
          id: newId(),
          page,
          x: action.x,
          y: action.y,
          width: action.width,
          height: action.height,
          color: reviewRgb,
          opacity: tool === 'highlight' ? 0.38 : 1,
          author: reviewAuthor.trim() || t.studio.defaultReviewer,
          body: '',
          createdAt: new Date().toISOString(),
          replies: [],
        },
      });
      return;
    }

    if (tool === 'comment' && action.kind === 'point') {
      const body = commentBody.trim();
      if (body === '') return;
      addEdit({
        kind: 'draw',
        mark: {
          kind: 'comment',
          id: newId(),
          page,
          x: action.x,
          y: action.y,
          color: reviewRgb,
          author: reviewAuthor.trim() || t.studio.defaultReviewer,
          body,
          createdAt: new Date().toISOString(),
          replies: [],
        },
      });
      setCommentBody('');
      return;
    }

    if (tool === 'redact' && action.kind === 'rect') {
      // Added to whatever was already painted out on this page, so a second
      // stroke does not undo the first.
      const existing = viewPages[pageIndex]?.raster?.boxes ?? [];
      void rasterisePage([
        ...existing,
        { x: action.x, y: action.y, width: action.width, height: action.height },
      ]);
      return;
    }

    if (tool === 'crop' && action.kind === 'rect') {
      addEdit({
        kind: 'crop',
        page,
        box: { x: action.x, y: action.y, width: action.width, height: action.height },
      });
      return;
    }

    if (tool === 'text' && action.kind === 'point') {
      const text = textValue.trim();
      if (text === '') return;
      const mark: Mark = {
        kind: 'text',
        id: newId(),
        page,
        x: action.x,
        y: action.y,
        text,
        size: textSize,
        color: rgbColor,
        // Upright against the page as it is displayed right now. From here on
        // the text is page content, so turning the page turns the text too.
        rotate: uprightTextRotation(pageRotation),
        font: { family: 'helvetica', bold: false, italic: false },
      };
      addEdit({ kind: 'draw', mark });
      return;
    }

    if (tool === 'rect' && action.kind === 'rect') {
      addEdit({
        kind: 'draw',
        mark: {
          kind: 'rect',
          id: newId(),
          page,
          x: action.x,
          y: action.y,
          width: action.width,
          height: action.height,
          color: null,
          borderColor: rgbColor,
          borderWidth: inkWidth,
          opacity: 1,
        },
      });
      return;
    }

    if (tool === 'ink' && action.kind === 'path') {
      addEdit({
        kind: 'draw',
        mark: {
          kind: 'ink',
          id: newId(),
          page,
          points: action.points,
          color: rgbColor,
          width: inkWidth,
        },
      });
      return;
    }

    if (tool === 'image' && action.kind === 'point' && pendingImage) {
      // A quarter of the page wide at most, which is a sensible stamp, in the
      // image's OWN shape — it used to be forced square, and a scanned
      // signature came out crushed. The reader can undo and place it again
      // rather than fight a resize handle.
      addEdit({
        kind: 'draw',
        mark: {
          kind: 'image',
          id: newId(),
          page,
          asset: pendingImage.id,
          x: action.x,
          y: action.y,
          ...fitWithin(pendingImage.width, pendingImage.height, IMAGE_STAMP_BOX),
          opacity: 1,
        },
      });
    }
  };

  const onInsertPdf = async (file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      assertFileSize(file, t, MAX_EDITABLE_BYTES);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const opened = await openPdf(bytes);
      const count = opened.document.numPages;
      await opened.destroy().catch(() => {});

      // Asked BEFORE anything is stored. An encrypted file is refused here,
      // with its own message — pdf.js opened it, pdf-lib will not — rather
      // than added to the script and failing every rebuild from then on until
      // the reader guesses what to undo. And said before the reader builds on
      // the assumption that it came along: copyPages copies pages, not
      // documents, and nothing can change that.
      const lost = await importedStructures(bytes);

      const id = newId();
      engine.putAsset(id, bytes);
      setAssets((current) => ({ ...current, [id]: bytes }));
      if (lost.length > 0) {
        setImportNotes((current) => [...current, { asset: id, name: file.name, lost }]);
      }

      addEdit({
        kind: 'insert',
        // Named, not numbered: by the time the imported file has been parsed
        // the live document may no longer match the rail the reader clicked on.
        before: viewPages[pageIndex]?.id ?? null,
        asset: id,
        indices: Array.from({ length: count }, (_, index) => index),
      });
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  const onPickImage = async (file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      assertFileSize(file, t, MAX_EDITABLE_BYTES);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (imageKind(bytes) === null) {
        setError({ kind: 'invalid', title: t.studio.tools.image, detail: t.watermark.imageNote });
        return;
      }
      const id = newId();
      engine.putAsset(id, bytes);
      setAssets((current) => ({ ...current, [id]: bytes }));
      // Decoded once, natively, to learn the shape. A file that will not
      // decode here is placed square and fails to embed later with its own
      // message; it must not take the editor down at the moment of choosing.
      let width = 0;
      let height = 0;
      try {
        const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart]));
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        // Square it is.
      }
      setPendingImage({ id, name: file.name, width, height });
      setTool('image');
      setToolMode('edit');
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  const onInsertImages = async (files: FileList) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const ids: string[] = [];
      const added: Record<string, Uint8Array> = {};
      for (const file of Array.from(files)) {
        assertFileSize(file, t, MAX_EDITABLE_BYTES);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (imageKind(bytes) === null) continue;
        const id = newId();
        engine.putAsset(id, bytes);
        added[id] = bytes;
        ids.push(id);
      }
      if (ids.length === 0) {
        setError({ kind: 'invalid', title: t.studio.insertImages, detail: t.watermark.imageNote });
        return;
      }
      setAssets((current) => ({ ...current, ...added }));
      addEdit({ kind: 'insertImages', before: viewPages[pageIndex]?.id ?? null, assets: ids });
    } catch (caught) {
      setError(describeError(caught, t));
    }
  };

  /**
   * Reads the page on screen and lays an invisible text layer over it.
   *
   * The words come back in the coordinates of the rendered image, which is the
   * page as displayed — so they go through the same geometry as a click before
   * becoming part of the page, and they carry the page's rotation so the layer
   * turns with it.
   */
  const runOcr = async () => {
    const page = pageIdAt(pageIndex);
    const document_ = built?.document;
    if (!page || !document_) return;

    setOcrBusy(true);
    setOcrResult(null);
    setError(null);

    let worker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null = null;
    try {
      const { OCR_SCALE, TESSERACT_PATHS } = await import('@/lib/ocrRuntime');
      // Loaded here rather than at the top of the route: the OCR engine is the
      // heaviest thing this page can reach, and most sessions never ask for it.
      const { createWorker } = await import('tesseract.js');
      const target = await document_.getPage(pageIndex + 1);
      const { blob, width, height } = await renderPageToJpeg(target, OCR_SCALE, 0.82);
      const viewport = target.getViewport({ scale: 1 });
      const rotation = target.rotate;
      target.cleanup();

      // The reader's own language rather than Spanish always: an English
      // document read with the Spanish model comes back worse for no reason.
      worker = await createWorker(locale === 'en' ? 'eng' : 'spa', 1, TESSERACT_PATHS);
      const { data } = await worker.recognize(blob, {}, RECOGNIZE_OUTPUT);

      // Measured with the same font the layer is drawn in, so the invisible
      // words sit over the visible ones rather than near them.
      const probe = await PDFDocument.create();
      const font = await probe.embedFont(StandardFonts.Helvetica);
      const measure = (text: string, size: number) => font.widthOfTextAtSize(text, size);

      const box = {
        x: viewport.viewBox[0],
        y: viewport.viewBox[1],
        width: viewport.viewBox[2] - viewport.viewBox[0],
        height: viewport.viewBox[3] - viewport.viewBox[1],
        rotation,
      };
      void width;
      void height;

      const words = extractOcrWords(data)
        .map((word) => {
          const text = toWinAnsi(word.text);
          if (text === '') return null;
          // Tesseract measures from the top of the image; the visual frame does
          // too, so this is a straight divide by the render scale.
          const point = visualToPdfPoint(box, word.left / OCR_SCALE, word.bottom / OCR_SCALE);
          // Measured on the text that will actually be drawn. Measuring the
          // original meant one word mixing Spanish with a character the font
          // cannot encode threw inside this map and took the whole layer with
          // it — the opposite of the per-word resilience the drawing side has.
          const size = fitFontSize({ ...word, text }, OCR_SCALE, measure);
          return { text, x: point.x, y: point.y, size };
        })
        .filter((word): word is { text: string; x: number; y: number; size: number } => word !== null);

      setOcrResult({ page, words: words.length });
      if (words.length > 0) {
        addEdit({
          kind: 'draw',
          mark: {
            kind: 'ocr',
            id: newId(),
            page,
            rotate: uprightTextRotation(rotation),
            words,
          },
        });
      }
    } catch (caught) {
      setError(describeStudioError(caught));
    } finally {
      await worker?.terminate().catch(() => {});
      setOcrBusy(false);
    }
  };

  /**
   * Turns the page on screen into a picture of itself, with `boxes` painted out
   * before the picture is made.
   *
   * The painting has to happen on the bitmap, never on the page afterwards: a
   * black rectangle drawn over an image leaves the image underneath in the
   * file, and anyone can lift it off. So the page is rendered, the regions are
   * filled on the canvas, and only then does the canvas become the page.
   *
   * It renders from a version of the document WITHOUT this page's existing
   * picture, so redacting twice does not photograph a photograph.
   */
  const rasterisePage = useCallback(
    async (boxes: readonly Rect[]) => {
      const engine = engineRef.current;
      const pageId = pageIdAt(pageIndex);
      if (!engine || !pageId || !original) return;

      setRasterising(true);
      setError(null);
      try {
        const bare: ScriptState = {
          ...state,
          pages: state.pages.map((page) =>
            page.id === pageId ? { ...page, raster: null } : page
          ),
        };
        const { bytes, placed } = await engine.render(bare);
        // Same reason as in findSurvivors: the page to photograph is the one
        // the produced document holds under this id, not the one the script
        // counted to.
        const at = placed.indexOf(pageId);
        if (at === -1) return;

        const opened = await openPdf(bytes);
        try {
          const target = await opened.document.getPage(at + 1);
          const viewport = target.getViewport({ scale: RASTER_SCALE });

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('This browser did not provide a 2D canvas context.');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await target.render({ canvas, canvasContext: context, viewport }).promise;

          // The regions, in the same pixels the page was just drawn in.
          context.fillStyle = '#000000';
          for (const box of boxes) {
            const a = pdfToViewportPoint(viewport, { x: box.x, y: box.y });
            const b = pdfToViewportPoint(viewport, {
              x: box.x + box.width,
              y: box.y + box.height,
            });
            context.fillRect(
              Math.min(a.x, b.x),
              Math.min(a.y, b.y),
              Math.abs(b.x - a.x),
              Math.abs(b.y - a.y)
            );
          }
          target.cleanup();

          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/png')
          );
          if (!blob) throw new Error('This browser could not produce the image.');
          const raster = new Uint8Array(await blob.arrayBuffer());

          const id = newId();
          engine.putAsset(id, raster);
          setAssets((current) => ({ ...current, [id]: raster }));
          addEdit({ kind: 'raster', page: pageId, raster: { asset: id, boxes } });
        } finally {
          await opened.destroy().catch(() => {});
        }
      } catch (caught) {
        setError(describeStudioError(caught));
      } finally {
        setRasterising(false);
      }
    },
    [addEdit, describeStudioError, original, pageIndex, state, pageIdAt]
  );

  /* -------------------------------------------------------------- export - */

  const doExport = async () => {
    const engine = engineRef.current;
    if (!engine || !original) return;
    setExporting(true);
    setBlocked(null);
    try {
      // The worker builds it and reads it: both the page count and the
      // structural comparison come from the produced bytes, and neither costs
      // the main thread a pdf-lib parse while the reader waits.
      const { bytes, pages, before, after, fields } = await engine.exportDocument(state);

      // Redaction is the one thing here that is checked BEFORE the file is
      // offered, and the only check that can refuse. Everything else reports;
      // this one withholds, because a document that looks redacted and is not
      // teaches the reader to stop being careful.
      const painted = redactedPages(state);
      let unproven = false;
      if (painted.length > 0) {
        setVerifying(true);
        const verdict = await findSurvivors(engine, state, painted, bytes);
        setVerifying(false);
        if (verdict.survivors.length > 0) {
          setBlocked(verdict.survivors);
          return;
        }
        // Nothing was found because there was nothing to look for. The page was
        // still replaced by a picture, so the redaction happened — but calling
        // that verified would be the same box-ticking this whole check exists
        // to refuse. A scan is the ordinary case, not an edge one.
        unproven = verdict.checked === 0;
      }
      setUnproven(unproven);

      setResult({
        blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
        pages,
        fields,
        report: {
          present: VERIFIABLE_CATEGORIES.filter((category) => before.categories[category] > 0),
          losses: diffStructures(before, after),
          // Both halves. The document arrived signed, AND the bytes are not
          // the ones it arrived as — an untouched export hands back the
          // original file exactly, and its signature is still good.
          signatureBroken:
            before.categories.signatures > 0 &&
            (bytes.length !== original.length ||
              !bytes.every((byte, index) => byte === original[index])),
        },
      });
    } catch (caught) {
      setError(describeStudioError(caught));
    } finally {
      setVerifying(false);
      setExporting(false);
    }
  };

  const closeSession = async () => {
    await clearSession();
    setBuilt(null);
    setOriginal(null);
    setName('');
    setScript({ edits: [], cursor: 0 });
    setAssets({});
    setPendingImage(null);
    setFormFields([]);
    setOriginalMetadata({});
    setSigned(false);
    setImportNotes([]);
    setOcrResult(null);
    setPanel('page');
    setSavedOk(null);
    setResult(null);
    setError(null);
  };

  const listFormat = (items: string[]) =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);

  const marksHere = (view?.marks ?? []).filter((mark) => mark.page === pageIdAt(pageIndex));

  /* ---------------------------------------------------------------- view - */

  if (!original) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 py-12">
          <div className="mb-10 text-center">
            <h1 className="mb-4 text-4xl font-bold text-gray-900">{t.studio.heading}</h1>
            <p className="text-gray-600">{t.studio.intro}</p>
          </div>

          {resumable && (
            <div className="mb-6 rounded-3xl border border-violet-200 bg-violet-50 p-6">
              <h2 className="mb-1 font-bold text-violet-900">{t.studio.resumeTitle}</h2>
              <p className="mb-4 text-sm text-violet-800">{t.studio.resumeBody(resumable.name)}</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    void beginSession(resumable.name, resumable.original, {
                      edits: resumable.edits,
                      cursor: resumable.cursor,
                      assets: resumable.assets ?? {},
                    })
                  }
                  className="rounded-full bg-violet-600 px-5 py-2.5 font-semibold text-white hover:bg-violet-700"
                >
                  {t.studio.resume}
                </button>
                <button
                  type="button"
                  onClick={() => void clearSession().then(() => setResumable(null))}
                  className="rounded-full bg-white px-5 py-2.5 font-semibold text-gray-700 hover:bg-gray-100"
                >
                  {t.studio.discard}
                </button>
              </div>
            </div>
          )}

          <FileDropzone
            inputId="studio-file-input"
            kind={PDF_FILES}
            onFilesSelected={([selected]) => void selectFile(selected)}
            className="cursor-pointer rounded-3xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-all hover:border-violet-400"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                <Upload className="h-8 w-8" />
              </div>
              <div>
                <p className="text-lg font-semibold">{t.studio.choose}</p>
                <p className="text-sm text-gray-500">{t.common.orDropIt}</p>
              </div>
            </div>
          </FileDropzone>
          <p className="mt-4 text-center text-sm text-gray-500">{t.studio.openNote}</p>
          <div className="mt-6">
            <ErrorNotice error={error} onDismiss={() => setError(null)} />
          </div>
        </main>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 py-16">
          <div className="rounded-3xl border bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
              <FileText className="h-10 w-10" />
            </div>
            <h2 className="mb-2 text-2xl font-bold">{t.studio.doneTitle(result.pages)}</h2>
            <p className="mb-4 text-gray-600">{t.studio.doneBody}</p>

            {result.fields.length > 0 && (
              <div className="mx-auto mb-4 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                {t.studio.fieldsNotWritten(result.fields.map((entry) => entry.field).join(', '))}
              </div>
            )}
            {result.report.losses.length > 0 ? (
              <div className="mx-auto mb-8 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                {t.studio.lostNote(
                  listFormat(result.report.losses.map((loss) => t.structures[loss.category]))
                )}
              </div>
            ) : result.report.present.length > 0 ? (
              <p className="mb-8 text-sm text-gray-500">
                {t.studio.keptNote(
                  listFormat(result.report.present.map((category) => t.structures[category]))
                )}
              </p>
            ) : (
              <div className="mb-8" />
            )}

            {result.report.signatureBroken && (
              /* Said again on the way out. The banner was a warning; this is a
                 fact about the file now in the reader's hands. */
              <p className="mx-auto mb-8 max-w-xl rounded-2xl bg-red-50 px-4 py-3 text-left text-sm text-red-900">
                {t.common.signatureBroken}
              </p>
            )}

            {unproven && (
              /* Said out loud rather than left to a green tick: the redaction
                 happened, and it could not be proven. Those are different
                 things, and the reader is the one who gets to weigh them. */
              <p className="mx-auto mb-8 max-w-xl rounded-2xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
                {t.studio.redactUnproven}
              </p>
            )}

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() => downloadBlob(result.blob, derivedFileName(name, '_studio.pdf'))}
                className="flex items-center gap-2 rounded-full bg-violet-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-700"
              >
                <Download className="h-5 w-5" /> {t.common.download}
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="rounded-full bg-gray-100 px-8 py-4 text-lg font-bold text-gray-700 hover:bg-gray-200"
              >
                {t.studio.keepEditing}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void closeSession()}
              className="mt-6 text-sm font-medium text-gray-500 underline hover:text-gray-700"
            >
              {t.studio.startOver}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const EDIT_TOOLS: Array<{ id: StageTool; label: string; icon: typeof Hand }> = [
    { id: 'pick', label: t.studio.tools.pick, icon: Hand },
    { id: 'text', label: t.studio.tools.text, icon: Type },
    { id: 'rect', label: t.studio.tools.rect, icon: Square },
    { id: 'ink', label: t.studio.tools.ink, icon: Pen },
    { id: 'image', label: t.studio.tools.image, icon: ImageUp },
    { id: 'crop', label: t.studio.tools.crop, icon: Crop },
    { id: 'redact', label: t.studio.tools.redact, icon: EyeOff },
  ];
  const REVIEW_TOOLS: Array<{ id: StageTool; label: string; icon: typeof Hand }> = [
    { id: 'highlight', label: t.studio.tools.highlight, icon: Highlighter },
    { id: 'underline', label: t.studio.tools.underline, icon: Underline },
    { id: 'strikeout', label: t.studio.tools.strikeout, icon: Strikethrough },
    { id: 'comment', label: t.studio.tools.comment, icon: MessageSquareText },
  ];
  const toolsShown = toolMode === 'review' ? REVIEW_TOOLS : EDIT_TOOLS;

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-5 w-5 shrink-0 text-violet-600" />
            <span className="truncate font-medium">{name}</span>
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {cursor === 0 ? t.studio.noEdits : t.studio.editCount(cursor)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={cursor === 0}
              title={t.studio.undoHint}
              className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" /> {t.studio.undo}
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={cursor >= edits.length}
              title={t.studio.redoHint}
              className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
            >
              <Redo2 className="h-4 w-4" /> {t.studio.redo}
            </button>

            {!live && (
              <button
                type="button"
                onClick={() => setNudge((value) => value + 1)}
                className="rounded-xl bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200"
              >
                {t.studio.checkPage}
              </button>
            )}

            <button
              type="button"
              onClick={() => void doExport()}
              disabled={exporting}
              className="flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 font-bold text-white hover:bg-violet-700 disabled:bg-gray-300"
            >
              {exporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />{' '}
                  {verifying ? t.studio.checkingRedaction : t.studio.exporting}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" /> {t.studio.exportAction}
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void closeSession()}
              aria-label={t.common.removeFile}
              className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <ErrorNotice error={error} onDismiss={() => setError(null)} />

        {blocked && (
          <div className="mb-3 rounded-2xl border-2 border-red-300 bg-red-50 p-4">
            <p className="mb-1 font-bold text-red-900">{t.studio.exportBlockedTitle}</p>
            <p className="text-sm text-red-900">
              {t.studio.exportBlockedBody(blocked.map((word) => `«${word}»`).join(', '))}
            </p>
            <button
              type="button"
              onClick={() => setBlocked(null)}
              className="mt-3 rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100"
            >
              {t.common.dismiss}
            </button>
          </div>
        )}

        {dropped > 0 && (
          /* A page the build could not produce. Said rather than absorbed: the
             alternative is a document that quietly has one page fewer than the
             rail claims, with every index after it pointing somewhere else. */
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {t.studio.droppedPages(dropped)}
          </p>
        )}
        {signed && (
          /* Red rather than amber, and first: every other notice here is about
             something the reader can weigh afterwards. This one is about work
             they may not want to start. */
          <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-bold">{t.studio.signedTitle}</p>
            <p className="mt-1">{t.studio.signedBody}</p>
          </div>
        )}
        {!offMainThread && (
          <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {t.studio.onMainThread}
          </p>
        )}
        {visibleImportNotes.map((note, index) => (
          <p
            key={`${note.asset}-${index}`}
            className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {t.studio.importedLost(
              note.name,
              listFormat(note.lost.map((category) => t.structures[category as never]))
            )}
          </p>
        ))}
        {!live && slowBecause !== null && (
          <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {t.studio.slowNote((slowBecause / 1000).toFixed(1))}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <Stage
              document={built?.document ?? null}
              pageIndex={pageIndex}
              tool={tool}
              busy={building}
              onAction={onStageAction}
            />

            <div className="flex items-center justify-center gap-4 text-sm">
              <button
                type="button"
                onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                disabled={pageIndex === 0}
                title={t.studio.previousHint}
                className="rounded-xl border bg-white px-3 py-1.5 disabled:opacity-30"
              >
                {t.studio.previous}
              </button>
              <span className="font-medium tabular-nums">
                {viewPages.length === 0
                  ? t.studio.building
                  : t.studio.pageOf(pageIndex + 1, viewPages.length)}
              </span>
              <button
                type="button"
                onClick={() => setPageIndex((index) => Math.min(viewPages.length - 1, index + 1))}
                disabled={pageIndex >= viewPages.length - 1}
                title={t.studio.nextHint}
                className="rounded-xl border bg-white px-3 py-1.5 disabled:opacity-30"
              >
                {t.studio.next}
              </button>
            </div>

            <PageStrip
              document={built?.document ?? null}
              signatures={signatures}
              current={pageIndex}
              onSelect={setPageIndex}
              disabled={building}
              onRotate={(index, turns) => {
                const page = pageIdAt(index);
                if (page) addEdit({ kind: 'rotate', page, turns });
              }}
              onDelete={(index) => {
                const page = pageIdAt(index);
                if (page) addEdit({ kind: 'delete', page });
              }}
              onMove={(index, to) => {
                const page = pageIdAt(index);
                if (!page) return;
                // "Before this page", read off the rail the reader is looking
                // at: moving earlier means before the tile to the left, moving
                // later means before the one two to the right (or the end).
                const anchor = to < index ? viewPages[to] : viewPages[index + 2];
                addEdit({ kind: 'move', page, before: anchor?.id ?? null });
              }}
            />
          </div>

          <aside className="space-y-5 rounded-3xl border bg-white p-5">
            <div role="tablist" className="flex gap-2 border-b pb-3">
              {(
                [
                  ['page', t.studio.tabPage],
                  ['document', t.studio.tabDocument],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={panel === value}
                  onClick={() => setPanel(value)}
                  className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                    panel === value
                      ? 'bg-violet-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {panel === 'document' ? (
              <DocumentPanel
                state={state}
                pageIds={viewPageIds}
                fields={formFields}
                originalMetadata={originalMetadata}
                /* Not disabled while rebuilding: every keystroke here schedules
                   a rebuild, so disabling on `building` would take the focus
                   away from the box the reader is typing in. The rebuild is
                   allowed to run behind them. */
                disabled={false}
                onMetadata={(patch: MetadataPatch) => addEdit({ kind: 'metadata', patch })}
                onField={(field, value) => addEdit({ kind: 'setField', field, value })}
                onFlattenForms={(on) => addEdit({ kind: 'flattenForms', on })}
                onWatermark={(spec: WatermarkSpec | null) => addEdit({ kind: 'watermark', spec })}
                onNumbering={(spec: NumberingSpec | null) => addEdit({ kind: 'numbering', spec })}
                onInsertImages={(files) => void onInsertImages(files)}
                onRunOcr={() => void runOcr()}
                ocrBusy={ocrBusy}
                ocrResult={
                  ocrResult && ocrResult.page === pageIdAt(pageIndex) ? ocrResult.words : null
                }
              />
            ) : (
            <>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" role="tablist">
              {(
                [
                  ['edit', t.studio.editTools],
                  ['review', t.studio.reviewTools],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={toolMode === mode}
                  onClick={() => {
                    setToolMode(mode);
                    setTool(mode === 'review' ? 'highlight' : 'pick');
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    toolMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {toolsShown.map(({ id, label, icon: Icon }) => {
                const shortcutIndex = TOOL_ORDER.indexOf(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={tool === id}
                    onClick={() => setTool(id)}
                    title={shortcutIndex === -1 ? label : `${label} · ${shortcutIndex + 1}`}
                    className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-xs font-medium transition-colors ${
                      tool === id
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-center leading-tight">{label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500">{t.studio.toolHint[tool]}</p>

            {toolMode === 'review' && (
              <>
                <Field label={t.studio.reviewer}>
                  <input
                    type="text"
                    value={reviewAuthor}
                    placeholder={t.studio.defaultReviewer}
                    onChange={(event) => setReviewAuthor(event.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-violet-400"
                  />
                </Field>
                {tool === 'comment' && (
                  <textarea
                    value={commentBody}
                    placeholder={t.studio.commentPlaceholder}
                    aria-label={t.studio.tools.comment}
                    rows={4}
                    onChange={(event) => setCommentBody(event.target.value)}
                    className="w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none focus:border-violet-400"
                  />
                )}
                <ColorRow label={t.stamp.color} value={reviewColor} onChange={setReviewColor} />
              </>
            )}

            {tool === 'text' && (
              <>
                <Field label={t.studio.tools.text}>
                  <input
                    type="text"
                    value={textValue}
                    placeholder={t.studio.textPlaceholder}
                    aria-label={t.studio.tools.text}
                    onChange={(event) => setTextValue(event.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-violet-400"
                  />
                </Field>
                <NumberRow label={t.stamp.size} value={textSize} min={4} max={200} onChange={setTextSize} />
              </>
            )}

            {(tool === 'rect' || tool === 'ink') && (
              <NumberRow
                label={t.studio.strokeWidth}
                value={inkWidth}
                min={1}
                max={30}
                onChange={setInkWidth}
              />
            )}

            {tool === 'image' && (
              <Field label={t.studio.tools.image} hint={t.watermark.imageNote}>
                <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
                  <ImageUp className="h-4 w-4" />
                  {pendingImage ? pendingImage.name : t.studio.addImageFirst}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(event) => {
                      const chosen = event.target.files?.[0];
                      if (chosen) void onPickImage(chosen);
                    }}
                  />
                </label>
              </Field>
            )}

            {toolMode === 'edit' && tool !== 'pick' && tool !== 'crop' && tool !== 'image' && (
              <ColorRow label={t.stamp.color} value={color} onChange={setColor} />
            )}

            {toolMode === 'edit' && (
            <>
            {tool === 'crop' && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {t.studio.cropHides}
              </p>
            )}

            {tool === 'redact' && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {t.studio.redactNote}
              </p>
            )}

            {tool === 'text' && (
              <p className="text-xs text-gray-400">{t.studio.textNotEditable}</p>
            )}

            {tool === 'crop' && viewPages[pageIndex]?.crop && (
              <button
                type="button"
                onClick={() => {
                  const page = pageIdAt(pageIndex);
                  if (page) addEdit({ kind: 'crop', page, box: null });
                }}
                className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                {t.studio.cropReset}
              </button>
            )}

            <div className="space-y-2 border-t pt-4">
              <button
                type="button"
                onClick={() => void rasterisePage(viewPages[pageIndex]?.raster?.boxes ?? [])}
                disabled={rasterising || building}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                {rasterising ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {t.studio.redactWorking}
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-4 w-4" /> {t.studio.pageToImage}
                  </>
                )}
              </button>
              <p className="text-xs text-gray-400">{t.studio.pageToImageNote}</p>
            </div>

            <div className="border-t pt-4">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
                <FilePlus2 className="h-4 w-4" />
                {t.studio.insert}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) void onInsertPdf(chosen);
                  }}
                />
              </label>
              <p className="mt-1 text-xs text-gray-400">{t.studio.insertHint}</p>
            </div>
            </>
            )}

            {marksHere.length > 0 && (
              <div className="border-t pt-4">
                <p className="mb-2 text-xs font-semibold text-gray-700">
                  {t.studio.marksOnPage(marksHere.length)}
                </p>
                <ul className="divide-y">
                  {marksHere.map((mark) => (
                    <li key={mark.id} className="space-y-2 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-gray-600">
                          {mark.kind === 'text' ? mark.text : t.studio.tools[mark.kind]}
                        </span>
                        <button
                          type="button"
                          onClick={() => addEdit({ kind: 'erase', markId: mark.id })}
                          aria-label={t.studio.removeMark}
                          className="rounded p-1 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {isReviewMark(mark) && mark.body !== '' && (
                        <div className="border-l-2 border-amber-300 pl-2 text-gray-600">
                          <p className="font-semibold">{mark.author}</p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words">{mark.body}</p>
                        </div>
                      )}

                      {mark.kind === 'comment' && (
                        <>
                          {mark.replies.length > 0 && (
                            <div className="space-y-2 pl-3">
                              <p className="font-medium text-gray-600">
                                {t.studio.replies(mark.replies.length)}
                              </p>
                              {mark.replies.map((reply) => (
                                <div key={reply.id} className="border-l-2 border-gray-200 pl-2">
                                  <p className="font-semibold text-gray-600">{reply.author}</p>
                                  <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-500">
                                    {reply.body}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex items-end gap-1.5">
                            <textarea
                              value={replyDrafts[mark.id] ?? ''}
                              placeholder={t.studio.replyPlaceholder}
                              aria-label={t.studio.replyPlaceholder}
                              rows={2}
                              onChange={(event) =>
                                setReplyDrafts((current) => ({
                                  ...current,
                                  [mark.id]: event.target.value,
                                }))
                              }
                              className="min-w-0 flex-1 resize-none rounded-lg border px-2 py-1.5 outline-none focus:border-violet-400"
                            />
                            <button
                              type="button"
                              onClick={() => addReply(mark)}
                              disabled={(replyDrafts[mark.id]?.trim() ?? '') === ''}
                              title={t.studio.reply}
                              aria-label={t.studio.reply}
                              className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:bg-gray-200"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            </>
            )}

            <div className="border-t pt-4 text-xs text-gray-600">
              {/* Nothing is claimed until a save has actually completed: the
                  first seconds of a session are exactly when it has not. */}
              {savedOk !== null && <p>{savedOk ? t.studio.saved : t.studio.notSaved}</p>}
              {building && <p className="mt-1 text-violet-600">{t.studio.building}</p>}
              <button
                type="button"
                onClick={() => void clearSession().then(() => setSavedOk(null))}
                className="mt-2 underline hover:text-gray-600"
              >
                {t.studio.forget}
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
