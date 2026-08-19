export interface PageRangeResult {
  /** 1-based page numbers, in the order the user asked for them. */
  pages: number[];
  /** Tokens that could not be understood, kept verbatim so the UI can quote them. */
  invalid: string[];
}

/**
 * Parses a page selection such as `1-3, 7, 12-9`.
 *
 * The order the user typed is preserved, so `3, 1` really does put page 3 first,
 * and a descending range like `12-9` counts backwards. Anything that cannot be
 * read is reported rather than dropped in silence.
 */
export function parsePageRange(input: string, pageCount: number): PageRangeResult {
  const pages: number[] = [];
  const invalid: string[] = [];

  if (pageCount < 1) return { pages, invalid };

  const clamp = (value: number) => Math.min(Math.max(value, 1), pageCount);

  for (const rawToken of input.split(',')) {
    const token = rawToken.trim();
    if (token === '') continue;

    const rangeMatch = token.match(/^(\d*)\s*-\s*(\d*)$/);

    if (rangeMatch) {
      const [, rawStart, rawEnd] = rangeMatch;
      if (rawStart === '' && rawEnd === '') {
        invalid.push(token);
        continue;
      }

      // An open end means "to the edge of the document": `5-` is 5 to the last
      // page, `-3` is the first page to 3.
      const start = clamp(rawStart === '' ? 1 : Number(rawStart));
      const end = clamp(rawEnd === '' ? pageCount : Number(rawEnd));
      const step = start <= end ? 1 : -1;

      for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
        pages.push(page);
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      const page = Number(token);
      if (page >= 1 && page <= pageCount) {
        pages.push(page);
      } else {
        invalid.push(token);
      }
      continue;
    }

    invalid.push(token);
  }

  return { pages, invalid };
}

/** `[1,2,3,7,9,10]` → `1-3, 7, 9-10`, for echoing a selection back to the reader. */
export function summarizePages(pages: number[]): string {
  if (pages.length === 0) return '';

  const parts: string[] = [];
  let start = pages[0];
  let previous = pages[0];

  for (let i = 1; i <= pages.length; i += 1) {
    const page = pages[i];
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = page;
    previous = page;
  }

  return parts.join(', ');
}
