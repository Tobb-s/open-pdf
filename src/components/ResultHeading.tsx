'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The heading of a result card, which takes the focus when it appears.
 *
 * Every tool here works the same way: you choose a file, you wait, and a card
 * replaces the form. For anyone not watching the screen, that moment passed in
 * silence — nothing was announced, and the focus, which had been on the button
 * that started the work, fell back to the body when that button unmounted. A
 * screen reader said nothing; a keyboard user was returned to the top of the
 * page with no idea the work had finished.
 *
 * Moving the focus here answers both at once: the heading is read out because
 * focus landed on it, and the next Tab continues from the result rather than
 * from the beginning. It is done with focus rather than with a live region on
 * purpose — a live region beside a focused heading says the same sentence
 * twice.
 *
 * `tabIndex={-1}` makes the heading focusable without putting it in the tab
 * order, which is what that value is for: reachable by script, never by Tab.
 */
export default function ResultHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // `preventScroll` because the card is already where the reader is looking;
    // jumping the viewport would undo the layout the tool just settled into.
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <h2 ref={ref} tabIndex={-1} className={cn('outline-none', className)}>
      {children}
    </h2>
  );
}
