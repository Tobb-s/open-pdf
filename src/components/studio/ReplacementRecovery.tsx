'use client';

import { useI18n } from '@/lib/i18n/context';
import { replacementCopy } from '@/lib/studio/replacementCopy';
import type { ReplacementFailure } from '@/lib/studio/replacementRecovery';

export default function ReplacementRecovery({ issue, font, usingCompatible, disabled, onCompatible, onNaturalWidth, onRebuild }: {
  issue: ReplacementFailure; font: string; usingCompatible: boolean; disabled: boolean;
  onCompatible: () => void; onNaturalWidth: () => void; onRebuild: () => void;
}) {
  const { locale } = useI18n();
  const copy = replacementCopy[locale];
  const explanation = issue.reason === 'missing-glyphs' ? (usingCompatible ? copy.compatibleMissing : copy.missing)
    : issue.reason === 'too-different' ? copy.different : issue.reason === 'ambiguous' ? copy.ambiguous : copy.unsupported;
  const actionStyle = 'w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-left font-semibold hover:bg-amber-100 disabled:opacity-50';
  return <section role="alert" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
    <p><strong>{copy.notApplied}</strong> {explanation}</p>
    {issue.missing.length > 0 && <p>{copy.missingCharacters}: <strong>{issue.missing.join(', ')}</strong></p>}
    {issue.reason === 'missing-glyphs' && !usingCompatible && <>
      <p>{copy.compatibleNote} ({font})</p>
      <button type="button" disabled={disabled} onClick={onCompatible} className={actionStyle}>
        {copy.retryCompatible} {font}
      </button>
    </>}
    {issue.reason === 'too-different' && <button type="button" disabled={disabled} onClick={onNaturalWidth} className={actionStyle}>
      {copy.retryNatural}
    </button>}
    <details>
      <summary className="cursor-pointer font-medium">{copy.moreOptions}</summary>
      <p className="my-2">{copy.rasterNote}</p>
      <button type="button" disabled={disabled} onClick={onRebuild} className={actionStyle}>{copy.prepareRebuild}</button>
    </details>
  </section>;
}
