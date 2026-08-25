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
