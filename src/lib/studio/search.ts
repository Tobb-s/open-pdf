import type { FlatTextRun } from '@/lib/studio/textReplacement';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface TextSearchHit {
  id: string;
  runIds: readonly string[];
  text: string;
  selectedText: string;
  relativeStart: number;
  relativeEnd: number;
  prefix: string;
  suffix: string;
  x: number;
  y: number;
  size: number;
  rotate: number;
  visual: { left: number; top: number; width: number; height: number };
}

type Span = { run: FlatTextRun; start: number; end: number };

const wordCharacter = (value: string | undefined): boolean =>
  value !== undefined && /[\p{L}\p{N}_]/u.test(value);

/** Finds non-overlapping text hits while retaining the runs needed to rewrite them safely. */
export function findTextHits(
  runs: readonly FlatTextRun[],
  query: string,
  options: SearchOptions
): TextSearchHit[] {
  const wanted = query.trim();
  if (wanted === '') return [];

  let source = '';
  const spans: Span[] = [];
  for (const run of runs) {
    if (source !== '' && !/\s$/.test(source) && !/^\s/.test(run.text)) source += ' ';
    const start = source.length;
    source += run.text;
    spans.push({ run, start, end: source.length });
  }

  const haystack = options.caseSensitive ? source : source.toLocaleLowerCase();
  const needle = options.caseSensitive ? wanted : wanted.toLocaleLowerCase();
  const hits: TextSearchHit[] = [];
  let from = 0;

  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) break;
    const end = start + needle.length;
    from = Math.max(end, start + 1);

    if (
      options.wholeWord &&
      (wordCharacter(source[start - 1]) || wordCharacter(source[end]))
    ) {
      continue;
    }

    const touched = spans.filter((span) => span.end > start && span.start < end);
    if (touched.length === 0) continue;
    const first = touched[0];
    const last = touched[touched.length - 1];
    const selectedStart = first.start;
    const selectedEnd = last.end;
    const left = Math.min(...touched.map(({ run }) => run.visual.left));
    const top = Math.min(...touched.map(({ run }) => run.visual.top));
    const right = Math.max(...touched.map(({ run }) => run.visual.left + run.visual.width));
    const bottom = Math.max(...touched.map(({ run }) => run.visual.top + run.visual.height));

    hits.push({
      id: `hit-${start}-${end}`,
      runIds: touched.map(({ run }) => run.id),
      text: source.slice(start, end),
      selectedText: source.slice(selectedStart, selectedEnd),
      relativeStart: start - selectedStart,
      relativeEnd: end - selectedStart,
      prefix: source.slice(selectedStart, start),
      suffix: source.slice(end, selectedEnd),
      x: first.run.x,
      y: first.run.y,
      size: first.run.size,
      rotate: first.run.rotate,
      visual: { left, top, width: right - left, height: bottom - top },
    });
  }

  return hits;
}

export function replacementText(hit: TextSearchHit, replacement: string): string {
  return `${hit.prefix}${replacement}${hit.suffix}`;
}
