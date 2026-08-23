'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { TOOLBOX } from '@/lib/tools';
import { TOOL_ICONS } from '@/lib/toolIcons';
import { cn } from '@/lib/utils';

/**
 * The toolbox, as a panel: every single-task tool with its icon, its name and
 * one line about it.
 *
 * It is the second level of the navigation. Fourteen entries in a row stopped
 * fitting some time ago — they had begun to cover the logo — and the fix is not
 * a smaller font but fewer things at the top: the tools live here, one step
 * down, and the bar above names only the two families. The same panel opens
 * from the desktop dropdown and from the phone menu, so there is one place to
 * keep right.
 */

interface ToolsMenuProps {
  /** Called after a tool is chosen, so whatever holds the panel can close. */
  onNavigate?: () => void;
  /** Columns at the panel's widest; it collapses to one below `sm`. */
  columns?: 2 | 3;
  /** Leave out the taglines, for a tighter panel. */
  compact?: boolean;
  className?: string;
}

export default function ToolsMenu({
  onNavigate,
  columns = 3,
  compact = false,
  className,
}: ToolsMenuProps) {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? '';

  return (
    <div className={className}>
      <ul
        className={cn(
          'grid gap-1',
          columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
        )}
      >
        {TOOLBOX.map((tool) => {
          const href = `/${locale}/${tool.slug}`;
          const active = pathname === href;
          const Icon = TOOL_ICONS[tool.slug];
          const copy = t.tools[tool.slug];

          const inner = (
            <>
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  tool.bgColor
                )}
              >
                <Icon className={cn('h-4.5 w-4.5', tool.color)} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {copy.title}
                </span>
                {!compact && (
                  <span className="mt-0.5 block truncate text-xs text-gray-500">
                    {copy.tagline}
                  </span>
                )}
              </span>
            </>
          );

          const itemClass = cn(
            'flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-gray-50',
            active && 'bg-gray-100'
          );

          return (
            <li key={tool.slug}>
              {/* A plain anchor forces a document request, which is the only
                  way the route's isolation headers reach the browser. */}
              {tool.needsFreshDocument ? (
                <a
                  href={href}
                  className={itemClass}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  {inner}
                </a>
              ) : (
                <Link
                  href={href}
                  className={itemClass}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <Link
        href={`/${locale}#tools`}
        onClick={onNavigate}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
      >
        {t.nav.allTools}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
