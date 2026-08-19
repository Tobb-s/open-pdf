'use client';

import { AlertTriangle, X } from 'lucide-react';
import type { ToolError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/context';

interface ErrorNoticeProps {
  error: ToolError | null;
  onDismiss?: () => void;
}

/**
 * Shows a failure in the page instead of a native `alert()`, with a title that
 * names the cause and a line saying what the reader can do next.
 */
export default function ErrorNotice({ error, onDismiss }: ErrorNoticeProps) {
  const { t } = useI18n();
  if (!error) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-left"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-red-900">{error.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-red-800">{error.detail}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t.common.dismiss}
          className="rounded-full p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-700"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
