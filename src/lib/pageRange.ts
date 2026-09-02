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

export interface PagePart {
  /** 1-based, inclusive. */
  from: number;
  to: number;
}

/**
 * Cuts a document into `parts` runs of consecutive pages.
 *
 * The runs are as even as the page count allows and never equal by force: 700
 * pages in 6 gives four runs of 117 and two of 116, with the longer ones first.
 * Padding to make them equal would either drop pages or invent them, and a
 * reader splitting a book cares that every page is in exactly one piece.
 *
 * Asking for more parts than there are pages gives one part per page and no
 * empty ones.
 */
export function splitIntoParts(pageCount: number, parts: number): PagePart[] {
  if (pageCount < 1 || parts < 1) return [];

  const count = Math.min(Math.floor(parts), pageCount);
  const base = Math.floor(pageCount / count);
  const longer = pageCount % count;

  const result: PagePart[] = [];
  let from = 1;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < longer ? 1 : 0);
    result.push({ from, to: from + size - 1 });
    from += size;
  }
  return result;
}

/**
 * The same selection, read as a SET: sorted, without repeats.
 *
 * Order and repetition are the point for splitting, and a hazard for anything
 * that draws on a page — asking for `3, 3` would stamp page 3 twice, at double
 * opacity, and numbering would count it twice.
 */
export function parsePageSet(input: string, pageCount: number): PageRangeResult {
  const { pages, invalid } = parsePageRange(input, pageCount);
  return { pages: [...new Set(pages)].sort((a, b) => a - b), invalid };
}

/**
 * Whether a selection can be produced by TRIMMING the original document rather
 * than by assembling a new one from copied pages.
 *
 * It matters because the two produce different files. Trimming keeps the form,
 * the bookmarks, the attachments, the title and the language; assembling keeps
 * none of them — measured, on this project's own fixture, at six structures
 * lost for asking to extract a document's every page.
 *
 * The one thing trimming cannot do is hand back the same page twice, because a
 * page cannot be deleted twice. `parsePageRange` allows repeats on purpose — a
 * reader may want a page duplicated — so that selection has to fall back, and
 * the tool says what it cost. A reversed range is fine: «5-3» is three distinct
 * pages in a different order.
 */
export function canTrimTo(pages: readonly number[]): boolean {
  return new Set(pages).size === pages.length;
}

/**
 * Groups consecutive pages into chunks such that each chunk stays under maxBytesPerPart.
 */
export function splitByTargetSize(
  pageCount: number,
  totalBytes: number,
  maxBytesPerPart: number,
  pageByteSizes?: number[]
): PagePart[] {
  if (pageCount < 1) return [];
  if (maxBytesPerPart <= 0 || maxBytesPerPart >= totalBytes) {
    return [{ from: 1, to: pageCount }];
  }

  const parts: PagePart[] = [];
  let chunkStart = 1;
  let currentChunkBytes = 0;

  for (let page = 1; page <= pageCount; page++) {
    const pageSize = pageByteSizes?.[page - 1] ?? Math.ceil(totalBytes / pageCount);

    if (currentChunkBytes + pageSize > maxBytesPerPart && page > chunkStart) {
      parts.push({ from: chunkStart, to: page - 1 });
      chunkStart = page;
      currentChunkBytes = pageSize;
    } else {
      currentChunkBytes += pageSize;
    }
  }

  if (chunkStart <= pageCount) {
    parts.push({ from: chunkStart, to: pageCount });
  }

  return parts;
}
