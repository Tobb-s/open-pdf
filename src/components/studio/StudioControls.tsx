import type { LucideIcon } from 'lucide-react';
import {
  Circle,
  Crop,
  Download,
  Eraser,
  EyeOff,
  FileText,
  Hand,
  Highlighter,
  ImageUp,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minus,
  Pen,
  Pilcrow,
  Redo2,
  Replace,
  Signature,
  Square,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { StageTool } from '@/components/studio/Stage';
import { useI18n } from '@/lib/i18n/context';
import type { DetectedPdfFont } from '@/lib/studio/fonts';
import { TOOL_ORDER } from '@/lib/studio/shortcuts';
import { EDIT_TOOL_IDS, REVIEW_TOOL_IDS } from '@/lib/studio/toolbars';

export function SourceFontControl({
  id,
  source,
  useSource,
  onUseSource,
}: {
  id: string;
  source: DetectedPdfFont | null;
  useSource: boolean;
  onUseSource: (next: boolean) => void;
}) {
  const { t } = useI18n();
  if (!source) return null;

  return (
    <div className="border border-cyan-200 bg-cyan-50 px-3 py-2.5 text-xs text-cyan-950">
      <p className="font-semibold">{t.studio.sourceFontDetected(source.name)}</p>
      {source.bytes ? (
        <>
          <p className="mt-1">{t.studio.sourceFontAvailable}</p>
          <label htmlFor={id} className="mt-2 flex cursor-pointer items-center gap-2 font-medium">
            <input
              id={id}
              type="checkbox"
              checked={useSource}
              onChange={(event) => onUseSource(event.target.checked)}
              className="h-4 w-4 accent-cyan-700"
            />
            {t.studio.sourceFontUse}
          </label>
          <p className="mt-1 text-cyan-800">{t.studio.sourceFontRights}</p>
        </>
      ) : (
        <p className="mt-1">{t.studio.sourceFontUnavailable}</p>
      )}
    </div>
  );
}

interface StudioTopBarProps {
  name: string;
  cursor: number;
  editCount: number;
  live: boolean;
  exporting: boolean;
  verifying: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRebuild: () => void;
  onExport: () => void;
  onClose: () => void;
}

export function StudioTopBar({
  name,
  cursor,
  editCount,
  live,
  exporting,
  verifying,
  onUndo,
  onRedo,
  onRebuild,
  onExport,
  onClose,
}: StudioTopBarProps) {
  const { t } = useI18n();

  return (
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
          onClick={onUndo}
          disabled={cursor === 0}
          title={t.studio.undoHint}
          className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" /> {t.studio.undo}
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={cursor >= editCount}
          title={t.studio.redoHint}
          className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
        >
          <Redo2 className="h-4 w-4" /> {t.studio.redo}
        </button>

        {!live && (
          <button
            type="button"
            onClick={onRebuild}
            className="rounded-xl bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200"
          >
            {t.studio.checkPage}
          </button>
        )}

        <button
          type="button"
          onClick={onExport}
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
          onClick={onClose}
          aria-label={t.common.removeFile}
          className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-500"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

interface StudioPageControlsProps {
  pageIndex: number;
  pageCount: number;
  zoom: number;
  onPageChange: (pageIndex: number) => void;
  onZoomChange: (zoom: number) => void;
}

export function StudioPageControls({
  pageIndex,
  pageCount,
  zoom,
  onPageChange,
  onZoomChange,
}: StudioPageControlsProps) {
  const { t } = useI18n();
  const pageLabel = pageCount === 0 ? t.studio.building : t.studio.pageOf(pageIndex + 1, pageCount);

  return (
    <div className="order-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-2 py-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
          disabled={pageIndex === 0}
          title={t.studio.previousHint}
          aria-label={t.studio.previousHint}
          className="grid h-9 w-9 place-items-center rounded-md text-gray-700 hover:bg-gray-100 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-24 text-center text-sm font-medium tabular-nums text-gray-800">
          {pageLabel}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount - 1, pageIndex + 1))}
          disabled={pageIndex >= pageCount - 1}
          title={t.studio.nextHint}
          aria-label={t.studio.nextHint}
          className="grid h-9 w-9 place-items-center rounded-md text-gray-700 hover:bg-gray-100 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div role="group" aria-label={t.studio.zoomLevel(Math.round(zoom * 100))} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onZoomChange(Math.max(0.5, Number((zoom - 0.25).toFixed(2))))}
          disabled={zoom <= 0.5}
          title={t.studio.zoomOut}
          aria-label={t.studio.zoomOut}
          className="grid h-9 w-9 place-items-center rounded-md text-gray-700 hover:bg-gray-100 disabled:opacity-30"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <output className="min-w-14 text-center text-xs font-semibold tabular-nums text-gray-700">
          {Math.round(zoom * 100)}%
        </output>
        <button
          type="button"
          onClick={() => onZoomChange(Math.min(2.5, Number((zoom + 0.25).toFixed(2))))}
          disabled={zoom >= 2.5}
          title={t.studio.zoomIn}
          aria-label={t.studio.zoomIn}
          className="grid h-9 w-9 place-items-center rounded-md text-gray-700 hover:bg-gray-100 disabled:opacity-30"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onZoomChange(1)}
          disabled={zoom === 1}
          title={t.studio.zoomFit}
          aria-label={t.studio.zoomFit}
          className="grid h-9 w-9 place-items-center rounded-md text-gray-700 hover:bg-gray-100 disabled:opacity-30"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

type StudioToolMode = 'edit' | 'review';

interface StudioToolPickerProps {
  mode: StudioToolMode;
  tool: StageTool;
  onModeChange: (mode: StudioToolMode) => void;
  onToolChange: (tool: StageTool) => void;
}

export function StudioToolPicker({
  mode,
  tool,
  onModeChange,
  onToolChange,
}: StudioToolPickerProps) {
  const { t } = useI18n();
  const faces: Record<StageTool, { label: string; icon: LucideIcon }> = {
    pick: { label: t.studio.tools.pick, icon: Hand },
    text: { label: t.studio.tools.text, icon: Type },
    rect: { label: t.studio.tools.rect, icon: Square },
    ink: { label: t.studio.tools.ink, icon: Pen },
    image: { label: t.studio.tools.image, icon: ImageUp },
    crop: { label: t.studio.tools.crop, icon: Crop },
    redact: { label: t.studio.tools.redact, icon: EyeOff },
    erase: { label: t.studio.tools.erase, icon: Eraser },
    line: { label: t.studio.tools.line, icon: Minus },
    ellipse: { label: t.studio.tools.ellipse, icon: Circle },
    replaceText: { label: t.studio.tools.replaceText, icon: Replace },
    paragraph: { label: t.studio.tools.paragraph, icon: Pilcrow },
    signature: { label: t.studio.tools.signature, icon: Signature },
    highlight: { label: t.studio.tools.highlight, icon: Highlighter },
    underline: { label: t.studio.tools.underline, icon: Underline },
    strikeout: { label: t.studio.tools.strikeout, icon: Strikethrough },
    comment: { label: t.studio.tools.comment, icon: MessageSquareText },
  };
  const tools = mode === 'review' ? REVIEW_TOOL_IDS : EDIT_TOOL_IDS;

  return (
    <>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" role="tablist">
        {(
          [
            ['edit', t.studio.editTools],
            ['review', t.studio.reviewTools],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => onModeChange(value)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tools.map((id) => {
          const { label, icon: Icon } = faces[id];
          const shortcutIndex = TOOL_ORDER.indexOf(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              onClick={() => onToolChange(id)}
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
    </>
  );
}
