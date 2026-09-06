export interface ReplacementFailure {
  reason: 'missing-glyphs' | 'too-different' | 'ambiguous' | 'unsupported';
  missing: string[];
}

/** Worker errors cross the boundary as messages. Keep details bounded and render
 * them as React text, never HTML. Unknown errors must not enable a font bypass.
 */
export function replacementFailure(error: unknown): ReplacementFailure {
  const message = error instanceof Error ? error.message : '';
  const match = /native-text:(missing-glyphs|too-different|ambiguous|split)(?::\s*(.*))?/.exec(message);
  const reason = match?.[1] === 'split' ? 'ambiguous' : match?.[1] ?? 'unsupported';
  let missing: string[] = [];
  if (reason === 'missing-glyphs' && match?.[2]) {
    try {
      const value: unknown = JSON.parse(match[2]);
      if (Array.isArray(value)) missing = value.filter((item): item is string =>
        typeof item === 'string' && [...item].length === 1).slice(0, 24);
    } catch { /* Older sessions/errors have no structured character details. */ }
  }
  return { reason: reason as ReplacementFailure['reason'], missing };
}
