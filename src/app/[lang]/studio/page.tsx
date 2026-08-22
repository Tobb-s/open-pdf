'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import PageStrip from '@/components/studio/PageStrip';
import Stage, { type StageAction, type StageTool } from '@/components/studio/Stage';
import DocumentPanel, { type FormFieldInfo } from '@/components/studio/DocumentPanel';
import { ColorRow, Field, NumberRow } from '@/components/StampControls';
import {
  Crop,
  Download,
  FilePlus2,
  FileText,
  Hand,
  ImageUp,
  Loader2,
  Pen,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { describeError, type ToolError } from '@/lib/errors';
import { derivedFileName, downloadBlob } from '@/lib/files';
import { uprightTextRotation, visualToPdfPoint } from '@/lib/geometry';
import { assertFileSize } from '@/lib/limits';
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
  type NumberingSpec,
  type ScriptState,
  type WatermarkSpec,
} from '@/lib/studio/script';
import { importedStructures, type FieldCheck } from '@/lib/studio/verify';
import {
  clearSession,
  loadSession,
  saveSession,
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
 * What the opened document already says: its form and its metadata.
 *
 * pdf-lib is on the main thread for this single call, and deliberately: it
 * happens once when a file is chosen, before the editor is running, and it is
 * the only way to show the reader what is there before they change it.
 */
async function readDocumentFacts(
  bytes: Uint8Array
): Promise<{ fields: FormFieldInfo[]; metadata: Metadata }> {
  const { PDFCheckBox, PDFDropdown, PDFName, PDFRadioGroup, PDFTextField } = await import(
    'pdf-lib'
  );
  const { loadPdf } = await import('@/lib/pdfio');
  try {
    const document = await loadPdf(bytes, { updateMetadata: false });
    const language = document.catalog.get(PDFName.of('Lang'));
    const metadata: Metadata = {
      title: document.getTitle() ?? '',
      author: document.getAuthor() ?? '',
      language: language ? String(language).replace(/^\(|\)$/g, '') : '',
    };
    const found: FormFieldInfo[] = [];
    for (const field of document.getForm().getFields()) {
      const name = field.getName();
      if (field instanceof PDFTextField) {
        found.push({ name, type: 'text', original: field.getText() ?? '' });
      } else if (field instanceof PDFCheckBox) {
        found.push({ name, type: 'checkbox', original: field.isChecked() ? 'true' : 'false' });
      } else if (field instanceof PDFDropdown) {
        // `getOptions` returns what a reader sees and `getSelected` returns
        // what the file stores; on a document that gives them different words
        // the two do not line up, so the options carry the stored values.
        found.push({
          name,
          type: 'dropdown',
          original: field.getSelected()[0] ?? '',
          options: field.acroField.getOptions().map((option) => option.value.decodeText()),
        });
      } else if (field instanceof PDFRadioGroup) {
        found.push({
          name,
          type: 'radio',
          original: field.getSelected() ?? '',
          options: field.getOptions(),
        });
      }
    }
    return { fields: found, metadata };
  } catch {
    // A document with no form, or one pdf-lib will not read: nothing to show.
    return { fields: [], metadata: {} };
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
  const [pendingImage, setPendingImage] = useState<{ id: string; name: string } | null>(null);

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
  const viewPages = view?.pages ?? [];

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
      setPendingImage(null);
      setPanel('page');
      setOriginalMetadata({});
      setImportNotes([]);
      setOcrResult(null);
      setResult(null);
      setResumable(null);
      setLive(true);
      setSlowBecause(null);
      // Nothing has been written for THIS document yet, whatever was true of
      // the last one.
      setSavedOk(null);
    },
    []
  );

  const selectFile = async (selected: File) => {
    try {
      assertFileSize(selected, t);
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
      const { bytes, offMainThread: inWorker } = await engine.render(state);
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
      setBuilt({ document: opened.document, destroy: opened.destroy, state });
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
        // Only what the edit list still refers to. Anything else belonged to an
        // edit that was truncated away, and carrying it would grow the saved
        // session for a document that cannot reach it. The whole list is
        // scanned, not just the part before the cursor, so redo still works.
        const referenced = new Set<string>();
        for (const edit of edits) {
          if (edit.kind === 'insert') referenced.add(edit.asset);
          // Plural, and easy to forget: an image page's bytes live here and
          // nowhere else, so missing this line deleted them on the next save
          // and the pages came back blank after a resume.
          if (edit.kind === 'insertImages') for (const asset of edit.assets) referenced.add(asset);
          if (edit.kind === 'draw' && edit.mark.kind === 'image') referenced.add(edit.mark.asset);
        }
        const kept = Object.fromEntries(
          Object.entries(assets).filter(([id]) => referenced.has(id))
        );

        const ok = await saveSession({
          shape: SESSION_SHAPE,
          name,
          original,
          edits,
          cursor,
          assets: kept,
          savedAt: Date.now(),
        });
        setSavedOk(ok);
      })();
    }, 900);
    return () => clearTimeout(timer);
  }, [original, name, edits, cursor, assets]);

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
  const addEdit = useCallback((edit: Edit) => {
    setScript((current) => append(current.edits, current.cursor, edit));
  }, []);

  /**
   * The id of the page the reader is looking at.
   *
   * Read from the state the visible document was built from, never from the
   * live script: while a rebuild is in flight those two disagree, and using the
   * live one would apply an edit to a page the reader cannot see.
   */
  const pageIdAt = (index: number) => viewPages[index]?.id ?? null;

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
        return `${page.id}:${page.turns}:${crop}:${marks}`;
      }),
    [view]
  );

  const onStageAction = (action: StageAction, pageRotation: number) => {
    const page = pageIdAt(pageIndex);
    if (!page) return;
    const rgbColor = hexToRgb(color);

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
      // A quarter of the page wide, which is a sensible stamp; the reader can
      // undo and place it again rather than fight a resize handle.
      addEdit({
        kind: 'draw',
        mark: {
          kind: 'image',
          id: newId(),
          page,
          asset: pendingImage.id,
          x: action.x,
          y: action.y,
          width: 140,
          height: 140,
          opacity: 1,
        },
      });
    }
  };

  const onInsertPdf = async (file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      assertFileSize(file, t);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const opened = await openPdf(bytes);
      const count = opened.document.numPages;
      await opened.destroy().catch(() => {});

      const id = newId();
      engine.putAsset(id, bytes);
      setAssets((current) => ({ ...current, [id]: bytes }));

      // Said before the reader builds on the assumption that it came along:
      // copyPages copies pages, not documents, and nothing can change that.
      const lost = await importedStructures(bytes);
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
      assertFileSize(file, t);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (imageKind(bytes) === null) {
        setError({ kind: 'invalid', title: t.studio.tools.image, detail: t.watermark.imageNote });
        return;
      }
      const id = newId();
      engine.putAsset(id, bytes);
      setAssets((current) => ({ ...current, [id]: bytes }));
      setPendingImage({ id, name: file.name });
      setTool('image');
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
        assertFileSize(file, t);
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

  /* -------------------------------------------------------------- export - */

  const doExport = async () => {
    const engine = engineRef.current;
    if (!engine || !original) return;
    setExporting(true);
    try {
      // The worker builds it and reads it: both the page count and the
      // structural comparison come from the produced bytes, and neither costs
      // the main thread a pdf-lib parse while the reader waits.
      const { bytes, pages, before, after, fields } = await engine.exportDocument(state);

      setResult({
        blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
        pages,
        fields,
        report: {
          present: VERIFIABLE_CATEGORIES.filter((category) => before.categories[category] > 0),
          losses: diffStructures(before, after),
        },
      });
    } catch (caught) {
      setError(describeStudioError(caught));
    } finally {
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

  const TOOLS: Array<{ id: StageTool; label: string; icon: typeof Hand }> = [
    { id: 'pick', label: t.studio.tools.pick, icon: Hand },
    { id: 'text', label: t.studio.tools.text, icon: Type },
    { id: 'rect', label: t.studio.tools.rect, icon: Square },
    { id: 'ink', label: t.studio.tools.ink, icon: Pen },
    { id: 'image', label: t.studio.tools.image, icon: ImageUp },
    { id: 'crop', label: t.studio.tools.crop, icon: Crop },
  ];

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-5 w-5 shrink-0 text-violet-600" />
            <span className="truncate font-medium">{name}</span>
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {cursor === 0 ? t.studio.noEdits : t.studio.editCount(cursor)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setScript((current) => ({ ...current, cursor: Math.max(0, current.cursor - 1) }))
              }
              disabled={cursor === 0}
              className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" /> {t.studio.undo}
            </button>
            <button
              type="button"
              onClick={() =>
                setScript((current) => ({
                  ...current,
                  cursor: Math.min(current.edits.length, current.cursor + 1),
                }))
              }
              disabled={cursor >= edits.length}
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
                  <Loader2 className="h-4 w-4 animate-spin" /> {t.studio.exporting}
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
                fields={formFields}
                originalMetadata={originalMetadata}
                /* Not disabled while rebuilding: every keystroke here schedules
                   a rebuild, so disabling on `building` would take the focus
                   away from the box the reader is typing in. The rebuild is
                   allowed to run behind them. */
                disabled={false}
                onMetadata={(patch: MetadataPatch) => addEdit({ kind: 'metadata', patch })}
                onField={(field, value) => addEdit({ kind: 'setField', field, value })}
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
            <div className="grid grid-cols-3 gap-2">
              {TOOLS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tool === id}
                  onClick={() => setTool(id)}
                  className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-xs font-medium transition-colors ${
                    tool === id
                      ? 'bg-violet-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">{t.studio.toolHint[tool]}</p>

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

            {tool !== 'pick' && tool !== 'crop' && tool !== 'image' && (
              <ColorRow label={t.stamp.color} value={color} onChange={setColor} />
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

            {marksHere.length > 0 && (
              <div className="border-t pt-4">
                <p className="mb-2 text-xs font-semibold text-gray-700">
                  {t.studio.marksOnPage(marksHere.length)}
                </p>
                <ul className="space-y-1">
                  {marksHere.map((mark) => (
                    <li key={mark.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-gray-500">
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
                    </li>
                  ))}
                </ul>
              </div>
            )}

            </>
            )}

            <div className="border-t pt-4 text-xs text-gray-400">
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
