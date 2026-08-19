'use client';

import { useEffect, useState } from 'react';
import { Loader2, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';

interface ProgressPanelProps {
  message: string;
  percent: number;
  /** Rendered as a Cancel control when the work can be interrupted. */
  onCancel?: () => void;
  accent?: 'blue' | 'orange';
}

/**
 * Progress for a long, local operation.
 *
 * It also watches for the tab going into the background: pdf.js drives rendering
 * with `requestAnimationFrame`, which browsers do not fire in hidden tabs, so
 * work genuinely stops until the reader comes back. Saying so beats a bar that
 * appears to have frozen.
 */
export default function ProgressPanel({
  message,
  percent,
  onCancel,
  accent = 'blue',
}: ProgressPanelProps) {
  const { t } = useI18n();
  const [wasBackgrounded, setWasBackgrounded] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') setWasBackgrounded(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const bar = accent === 'orange' ? 'bg-orange-500' : 'bg-blue-600';
  const text = accent === 'orange' ? 'text-orange-600' : 'text-blue-600';

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between gap-4 text-sm font-semibold text-gray-700">
        <span className="flex min-w-0 items-center gap-2">
          <Loader2 className={cn('h-4 w-4 shrink-0 animate-spin', text)} />
          <span className="truncate">{message}</span>
        </span>
        <span className={cn('shrink-0 tabular-nums', text)}>{Math.round(percent)}%</span>
      </div>

      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn('h-2.5 rounded-full transition-all duration-300', bar)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <PauseCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {wasBackgrounded ? t.common.processingPaused : t.common.keepTabVisible}
        </p>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            {t.common.cancel}
          </button>
        )}
      </div>
    </div>
  );
}
