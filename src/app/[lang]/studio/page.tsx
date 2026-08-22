'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import Navbar from '@/components/Navbar';
import FileDropzone, { PDF_FILES } from '@/components/FileDropzone';
import ErrorNotice from '@/components/ErrorNotice';
import PageStrip from '@/components/studio/PageStrip';
import Stage, { type StageAction, type StageTool } from '@/components/studio/Stage';
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
import { uprightTextRotation } from '@/lib/geometry';
import { assertFileSize } from '@/lib/limits';
import { openPdf } from '@/lib/pdfjs';
import { hexToRgb, imageKind, UnsupportedCharacterError } from '@/lib/stamp';
import { createStudioEngine, type StudioEngine } from '@/lib/studio/engine';
import {
  append,
  stateAt,
  type Edit,
  type Mark,
  type ScriptState,
} from '@/lib/studio/script';
import { clearSession, loadSession, saveSession, type StoredSession } from '@/lib/studio/store';
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
 * A materialised document, together with the script state it came from.
 *
 * They travel as one on purpose. The rail, the page count and a click on the
 * canvas all describe what is ON SCREEN, and the screen is always a step behind
 * the script while a rebuild is in flight. Resolving any of them against the
 * live state instead would mean the reader marks one page and another one
 * changes.
 */
type Built = {
  bytes: Uint8Array;
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
  const [edits, setEdits] = useState<Edit[]>([]);
  const [cursor, setCursor] = useState(0);
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

  const [resumable, setResumable] = useState<StoredSession | null>(null);
  const [savedOk, setSavedOk] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; pages: number; report: StructuralReport } | null>(
    null
  );
  const [error, setError] = useState<ToolError | null>(null);

  const engineRef = useRef<StudioEngine | null>(null);
  /** The cursor, readable from callbacks that ran before the latest render. */
  const cursorRef = useRef(0);
  /** Bumped per rebuild so a slow one cannot overwrite a newer result. */
  const generationRef = useRef(0);

  // Releasing the previous render's pdf.js document: the cleanup runs with the
  // value that is being replaced, which is precisely the one to let go of.
  useEffect(() => () => void built?.destroy().catch(() => {}), [built]);

  const state: ScriptState = useMemo(
    () => stateAt(originalPages, edits, cursor),
    [originalPages, edits, cursor]
  );

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  /** What is on screen right now, which trails the script during a rebuild. */
  const view = built?.state ?? null;
  const viewPages = view?.pages ?? [];

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

      await engine.open(bytes);
      setOffMainThread(engine.offMainThread);
      const restoredAssets = restored?.assets ?? {};
      for (const [id, asset] of Object.entries(restoredAssets)) engine.putAsset(id, asset);

      setName(fileName);
      setOriginal(bytes);
      setOriginalPages(count);
      setEdits(restored?.edits ?? []);
      setCursor(restored?.cursor ?? 0);
      setAssets(restoredAssets);
      setPageIndex(0);
      setTool('pick');
      setResult(null);
      setResumable(null);
      setLive(true);
      setSlowBecause(null);
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
      const { bytes } = await engine.render(state);
      const opened = await openPdf(bytes);

      // A rebuild that started earlier must never land on top of a newer one.
      // Without this, a slow render of an old state can be the last to arrive
      // and leave the screen showing a document nobody asked for.
      if (generation !== generationRef.current) {
        await opened.destroy().catch(() => {});
        return;
      }

      setBuilt({ bytes, document: opened.document, destroy: opened.destroy, state });
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
          if (edit.kind === 'draw' && edit.mark.kind === 'image') referenced.add(edit.mark.asset);
        }
        const kept = Object.fromEntries(
          Object.entries(assets).filter(([id]) => referenced.has(id))
        );

        const ok = await saveSession({
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
   */
  const addEdit = useCallback((edit: Edit) => {
    setEdits((currentEdits) => {
      setCursor((currentCursor) => append(currentEdits, currentCursor, edit).cursor);
      return append(currentEdits, cursorRef.current, edit).edits;
    });
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
        const marks = (view?.marks ?? []).filter((mark) => mark.page === page.id).length;
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
      addEdit({
        kind: 'insert',
        at: pageIndex,
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

  /* -------------------------------------------------------------- export - */

  const doExport = async () => {
    const engine = engineRef.current;
    if (!engine || !original) return;
    setExporting(true);
    try {
      // The worker builds it and reads it: both the page count and the
      // structural comparison come from the produced bytes, and neither costs
      // the main thread a pdf-lib parse while the reader waits.
      const { bytes, pages, before, after } = await engine.exportDocument(state);

      setResult({
        blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
        pages,
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
    setEdits([]);
    setCursor(0);
    setAssets({});
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
              onClick={() => setCursor((value) => Math.max(0, value - 1))}
              disabled={cursor === 0}
              className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" /> {t.studio.undo}
            </button>
            <button
              type="button"
              onClick={() => setCursor((value) => Math.min(edits.length, value + 1))}
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
                {t.studio.pageOf(pageIndex + 1, viewPages.length)}
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
                if (page) addEdit({ kind: 'move', page, toIndex: to });
              }}
            />
          </div>

          <aside className="space-y-5 rounded-3xl border bg-white p-5">
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
