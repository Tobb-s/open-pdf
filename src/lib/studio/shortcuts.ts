import type { StageTool } from '@/components/studio/Stage';

/**
 * The keyboard in Studio.
 *
 * An editor built entirely around undo had Ctrl+Z bound to nothing. This is
 * the whole mapping, as a pure function of the key event, so the page does one
 * thing per answer and the mapping itself can be tested without a page.
 *
 * Kept deliberately small and language-neutral: the modifier pair everyone's
 * hands already know, the arrows for pages, Escape back to the hand, and the
 * digits for the tools in the order the toolbar shows them. Letters were not
 * used — «T» for text reads as English to a Spanish reader and collides with
 * whatever they are typing the moment a guard is missed.
 */

/** The toolbar's order, which is also what the digit keys mean. */
export const TOOL_ORDER: readonly StageTool[] = [
  'pick',
  'text',
  'rect',
  'ink',
  'image',
  'crop',
  'redact',
];

export type Shortcut =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'previousPage' }
  | { kind: 'nextPage' }
  | { kind: 'escape' }
  | { kind: 'tool'; tool: StageTool };

/** The slice of a KeyboardEvent the mapping reads, so a test can pass a literal. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** True mid-way through an IME composition, when keys are not commands. */
  isComposing?: boolean;
}

export function shortcutFor(event: KeyLike): Shortcut | null {
  if (event.isComposing) return null;
  const modifier = event.ctrlKey || event.metaKey;

  if (modifier) {
    if (event.altKey) return null;
    const key = event.key.toLowerCase();
    if (key === 'z') return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'y' && !event.shiftKey) return { kind: 'redo' };
    return null;
  }

  // Bare keys only: a shifted arrow or an alt-digit is something else's.
  if (event.altKey || event.shiftKey) return null;

  switch (event.key) {
    case 'ArrowLeft':
    case 'PageUp':
      return { kind: 'previousPage' };
    case 'ArrowRight':
    case 'PageDown':
      return { kind: 'nextPage' };
    case 'Escape':
      return { kind: 'escape' };
    default:
      break;
  }

  if (/^[1-9]$/.test(event.key)) {
    const tool = TOOL_ORDER[Number(event.key) - 1];
    return tool === undefined ? null : { kind: 'tool', tool };
  }

  return null;
}

/**
 * Whether a key went to something that takes typing.
 *
 * The panel is full of text boxes — a title, a field value, a watermark, a page
 * range — and «2» typed into one of them must stay a 2, not become the text
 * tool. Written against the DOM's shape rather than its classes, so it holds
 * in a test with no DOM.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === 'string' && /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}
