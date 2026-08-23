'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, FileText, Menu, X } from 'lucide-react';
import GitHubMark from '@/components/GitHubMark';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ToolsMenu from '@/components/ToolsMenu';
import { useI18n } from '@/lib/i18n/context';
import { STUDIO, TOOLBOX } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * The bar at the top of every page.
 *
 * Two entries, not fourteen. The tools used to be listed across the bar one by
 * one, and by the thirteenth they had begun to overlap the logo; the answer is
 * not a smaller font but a shallower top level. «Herramientas» opens a panel
 * holding the twelve; «Studio» is the editor and stands on its own. Below the
 * desktop breakpoint the same panel opens from a menu button — there used to be
 * no navigation at all on a phone.
 *
 * The dropdown opens on hover where hovering exists and on click everywhere,
 * and those two are kept apart on purpose: a click pins the panel open until
 * the reader clicks away or presses Escape, so hovering off it by accident
 * does not take it with it.
 */

const REPO_URL = 'https://github.com/Tobb-s/open-pdf';

/** Whether the device can hover at all; a touch screen cannot. */
function useCanHover(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia('(hover: hover)');
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(hover: hover)').matches,
    () => false
  );
}

export default function Navbar() {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? `/${locale}`;
  const canHover = useCanHover();
  const panelId = useId();
  const sheetId = useId();

  /** Pinned by a click; hovering is the other way the panel can be open. */
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const toolsOpen = pinned || hovering;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<number | null>(null);

  const closeAll = useCallback(() => {
    setPinned(false);
    setHovering(false);
    setSheetOpen(false);
  }, []);

  // Escape closes whatever is open; a click outside unpins the dropdown.
  useEffect(() => {
    if (!toolsOpen && !sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAll();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [toolsOpen, sheetOpen, closeAll]);

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    []
  );

  const onEnter = () => {
    if (!canHover) return;
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    setHovering(true);
  };
  const onLeave = () => {
    if (!canHover) return;
    // A short grace so the pointer can travel from the button to the panel.
    leaveTimer.current = window.setTimeout(() => setHovering(false), 140);
  };

  const onTool = TOOLBOX.some((tool) => pathname === `/${locale}/${tool.slug}`);
  const onStudio = pathname === `/${locale}/${STUDIO}`;

  const pill =
    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors';

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="flex h-16 items-center gap-3">
          <Link
            href={`/${locale}`}
            onClick={closeAll}
            className="flex shrink-0 items-center gap-2 text-xl tracking-tight text-gray-800"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
              <FileText className="h-5 w-5" />
            </div>
            <span className="font-semibold text-gray-900">
              Open<span className="font-normal text-gray-500">PDF</span>
            </span>
          </Link>

          {/* Desktop: two entries. */}
          <div className="ml-4 hidden items-center gap-1 lg:flex">
            <div
              ref={wrapperRef}
              className="relative"
              onPointerEnter={onEnter}
              onPointerLeave={onLeave}
              onBlur={(event) => {
                // Focus leaving the whole group — button and panel — unpins.
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setPinned(false);
                }
              }}
            >
              <button
                type="button"
                aria-expanded={toolsOpen}
                aria-controls={panelId}
                onClick={() => setPinned((current) => !current)}
                className={cn(
                  pill,
                  toolsOpen || onTool
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                {t.nav.tools}
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-gray-400 transition-transform',
                    toolsOpen && 'rotate-180'
                  )}
                  aria-hidden="true"
                />
              </button>

              {toolsOpen && (
                <div
                  id={panelId}
                  className="absolute left-0 top-full mt-2 w-[42rem] rounded-3xl border border-gray-100 bg-white p-4 shadow-xl shadow-gray-900/[0.06]"
                >
                  <p className="px-3 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                    {t.home.toolsName}
                    <span className="ml-2 normal-case tracking-normal text-gray-400">
                      — {t.nav.toolsHint}
                    </span>
                  </p>
                  <ToolsMenu onNavigate={closeAll} />
                </div>
              )}
            </div>

            <Link
              href={`/${locale}/${STUDIO}`}
              onClick={closeAll}
              aria-current={onStudio ? 'page' : undefined}
              className={cn(
                pill,
                onStudio
                  ? 'bg-violet-50 text-violet-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              {t.tools.studio.navLabel}
            </Link>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.nav.github}
              title={t.nav.github}
              className="hidden h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:inline-flex"
            >
              <GitHubMark />
            </a>
            <LanguageSwitcher className="shrink-0" />
            <button
              type="button"
              aria-expanded={sheetOpen}
              aria-controls={sheetId}
              aria-label={sheetOpen ? t.nav.closeMenu : t.nav.menu}
              onClick={() => setSheetOpen((current) => !current)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-50 lg:hidden"
            >
              {sheetOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Phones and tablets: the same two families, stacked. */}
      {sheetOpen && (
        <div
          id={sheetId}
          className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-gray-100 bg-white lg:hidden"
        >
          <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-8">
            <Link
              href={`/${locale}/${STUDIO}`}
              onClick={closeAll}
              className="flex items-center justify-between rounded-2xl bg-violet-50 px-4 py-3.5 text-violet-900"
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{t.tools.studio.title}</span>
                <span className="text-xs text-violet-700/80">{t.tools.studio.tagline}</span>
              </span>
              <ChevronDown className="h-4 w-4 -rotate-90 text-violet-400" aria-hidden="true" />
            </Link>

            <div>
              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                {t.home.toolsName}
              </p>
              <ToolsMenu onNavigate={closeAll} columns={2} compact />
            </div>

            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-1 text-sm font-medium text-gray-600 sm:hidden"
            >
              <GitHubMark className="h-4 w-4" />
              {t.nav.github}
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
