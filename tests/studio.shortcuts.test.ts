import { ALL_TOOL_IDS, EDIT_TOOL_IDS, REVIEW_TOOL_IDS } from '@/lib/studio/toolbars';
import { describe, expect, it } from 'vitest';
import {
  isEditableTarget,
  shortcutFor,
  TOOL_ORDER,
  type KeyLike,
} from '@/lib/studio/shortcuts';

/**
 * The keyboard Studio never had. An editor built entirely around undo had
 * Ctrl+Z bound to nothing.
 *
 * The mapping is a pure function of the key event, so it is tested here without
 * a page; the page's only job is to route what this returns and to stay out of
 * the way while the reader is typing.
 */

const key = (over: Partial<KeyLike>): KeyLike => ({
  key: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe('shortcutFor', () => {
  it('undoes on Ctrl+Z and Cmd+Z', () => {
    expect(shortcutFor(key({ key: 'z', ctrlKey: true }))).toEqual({ kind: 'undo' });
    expect(shortcutFor(key({ key: 'z', metaKey: true }))).toEqual({ kind: 'undo' });
  });

  it('redoes on Shift+Ctrl+Z and on Ctrl+Y', () => {
    expect(shortcutFor(key({ key: 'z', ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'redo' });
    expect(shortcutFor(key({ key: 'y', ctrlKey: true }))).toEqual({ kind: 'redo' });
  });

  it('is case-blind, so Caps Lock does not turn undo into redo', () => {
    // Capital Z with Caps Lock and no Shift is still undo — only the Shift
    // flag decides, not the letter case the OS reports.
    expect(shortcutFor(key({ key: 'Z', ctrlKey: true }))).toEqual({ kind: 'undo' });
    expect(shortcutFor(key({ key: 'Z', metaKey: true, shiftKey: true }))).toEqual({ kind: 'redo' });
  });

  it('moves through the pages with the arrows', () => {
    expect(shortcutFor(key({ key: 'ArrowLeft' }))).toEqual({ kind: 'previousPage' });
    expect(shortcutFor(key({ key: 'ArrowRight' }))).toEqual({ kind: 'nextPage' });
    expect(shortcutFor(key({ key: 'PageUp' }))).toEqual({ kind: 'previousPage' });
    expect(shortcutFor(key({ key: 'PageDown' }))).toEqual({ kind: 'nextPage' });
  });

  it('returns to the hand tool on Escape', () => {
    expect(shortcutFor(key({ key: 'Escape' }))).toEqual({ kind: 'escape' });
  });

  it('selects each tool by its position in the toolbar', () => {
    for (let index = 0; index < TOOL_ORDER.length; index += 1) {
      expect(shortcutFor(key({ key: String(index + 1) }))).toEqual({
        kind: 'tool',
        tool: TOOL_ORDER[index],
      });
    }
  });

  it('ignores a digit with no tool at that position', () => {
    // Zero is never a tool and must not wrap around.
    expect(shortcutFor(key({ key: '0' }))).toBeNull();
  });

  it('leaves a modified navigation key to the browser', () => {
    // Ctrl+ArrowRight is word-jump; Alt+Left is Back. Studio takes neither.
    expect(shortcutFor(key({ key: 'ArrowRight', ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: 'ArrowLeft', altKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: '2', altKey: true }))).toBeNull();
  });

  it('never fires mid-IME-composition', () => {
    // A Japanese or accent composition sends keydowns that are not commands.
    expect(shortcutFor(key({ key: 'z', ctrlKey: true, isComposing: true }))).toBeNull();
    expect(shortcutFor(key({ key: '2', isComposing: true }))).toBeNull();
  });

  it('has nothing to say about an ordinary letter', () => {
    expect(shortcutFor(key({ key: 'a' }))).toBeNull();
    expect(shortcutFor(key({ key: 'T' }))).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('is true for the fields the panel is full of', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('is false for the canvas and the buttons, where a shortcut belongs', () => {
    expect(isEditableTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

/**
 * The digits and the buttons, kept in step.
 *
 * They drifted apart once and nothing noticed: three tools were inserted in the
 * middle of the toolbar, after which the eighth button was the eraser while «8»
 * still selected the highlighter. The order now lives in a module a test can
 * reach, and these are the two things that must stay true of it.
 */
describe('the keyboard against the toolbars', () => {
  it('never gives a digit to a tool no toolbar offers', () => {
    for (const tool of TOOL_ORDER) {
      expect(ALL_TOOL_IDS).toContain(tool);
    }
  });

  it('gives no tool two digits', () => {
    expect(new Set(TOOL_ORDER).size).toBe(TOOL_ORDER.length);
  });

  it('asks for no more than the nine digits there are', () => {
    expect(TOOL_ORDER.length).toBeLessThanOrEqual(9);
  });

  it('leaves the image tool out, because its key would usually do nothing', () => {
    // It needs an image chosen from the panel first; the page skips the digit
    // when there is none. A key that usually does nothing teaches the reader
    // that the keys do not work.
    expect(TOOL_ORDER).not.toContain('image');
  });

  it('lists every tool exactly once across the two toolbars', () => {
    expect(new Set(ALL_TOOL_IDS).size).toBe(ALL_TOOL_IDS.length);
    for (const tool of EDIT_TOOL_IDS) expect(REVIEW_TOOL_IDS).not.toContain(tool);
  });
});
