'use client';

import type { FlatTextRun } from '@/lib/studio/textReplacement';
import { useI18n } from '@/lib/i18n/context';
import { replacementCopy } from '@/lib/studio/replacementCopy';
import { describeStyle, type DetectedFont } from '@/lib/studio/fontStyle';

export default function TextFormatInspector({ run, fontStyle }: { run: FlatTextRun; fontStyle?: DetectedFont }) {
  const { locale, t } = useI18n();
  const copy = replacementCopy[locale];
  const number = (n: number) => (Math.abs(n) < 0.005 ? 0 : n).toLocaleString(locale, { maximumFractionDigits: 2 });
  const appearance = run.appearance;
  const values = [
    [copy.font, (run.sourceFont?.name ?? copy.unknown) + (fontStyle ? ` (${describeStyle(fontStyle,
      { bold: t.stamp.bold, italic: t.stamp.italic, regular: t.studio.fontRegular })})` : '')],
    [t.stamp.size, `${number(run.size)} pt`],
    [t.stamp.color, appearance?.color ?? copy.unknown],
    [copy.dimensions, `${number(run.visual.width)} × ${number(run.visual.height)} pt`],
    [copy.position, run.source ? `x ${number(run.source.x)}, y ${number(run.source.y)} pt` : copy.unknown],
    [copy.rotation, `${number(run.rotate)}°`],
    [copy.opacity, appearance?.opacity != null ? `${number(appearance.opacity * 100)}%` : copy.unknown],
    [copy.scale, appearance ? `${number(appearance.horizontalScale * 100)}%` : copy.unknown],
    [copy.spacing, appearance ? `${number(appearance.charSpacing)} / ${number(appearance.wordSpacing)} pt` : copy.unknown],
    [copy.layer, appearance?.layer ?? copy.layerUnknown],
  ];
  return <section aria-label={copy.detected} className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-950">
    <h3 className="mb-2 font-semibold">{copy.detected}</h3>
    <dl className="space-y-1.5">{values.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-cyan-800">{label}</dt><dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>)}</dl>
    <p className="mt-2">{run.metrics === 'font' ? copy.metrics : copy.estimated}</p>
    {!appearance?.color && <p className="mt-2">{copy.colorUnknown}</p>}
    {appearance?.mode === 3 && <p className="mt-2 font-semibold">{copy.hidden}</p>}
  </section>;
}
