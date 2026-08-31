import type { StageTool } from '@/components/studio/Stage';

/**
 * Which tools each toolbar holds, and in what order.
 *
 * Declared here rather than inside the page so that the keyboard mapping can be
 * checked against it. The two lists had drifted apart once already: a digit
 * named a tool the visible toolbar no longer showed in that position, and
 * nothing could notice because the toolbar lived in a component no test reaches.
 *
 * The labels and the icons stay in the page — they are presentation, and they
 * need the dictionary. This is only the roster.
 */

export const EDIT_TOOL_IDS: readonly StageTool[] = [
  'pick',
  'text',
  'rect',
  'ink',
  'image',
  'crop',
  'redact',
  'erase',
  'line',
  'ellipse',
  'replaceText',
  'paragraph',
  'signature',
];

export const REVIEW_TOOL_IDS: readonly StageTool[] = [
  'highlight',
  'underline',
  'strikeout',
  'comment',
];

/** Every tool a reader can reach from either toolbar. */
export const ALL_TOOL_IDS: readonly StageTool[] = [...EDIT_TOOL_IDS, ...REVIEW_TOOL_IDS];
