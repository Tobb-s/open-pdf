import { PDFDocument } from 'pdf-lib';

export interface CombinePart {
  /** A PDF produced earlier in the batch. */
  bytes: Uint8Array;
  /** Only used to name the part in an error, so a failure says which file. */
  label: string;
}

export interface CombineResult {
  bytes: Uint8Array;
  pages: number;
  /** Parts that could not be appended, by label. The rest still made it in. */
  skipped: string[];
}

export interface CombineOptions {
  /** Called before each part, so a slow join can show which one it is on. */
  onProgress?: (index: number, total: number, label: string) => void;
  signal?: AbortSignal;
}

/**
 * Joins several PDFs into one, in the order given.
 *
 * A part that cannot be read is skipped rather than allowed to sink the whole
 * batch — losing one lecture out of seven is bad, losing all seven because of
 * it is worse. The caller is handed the list so it can say which.
 */
export async function combinePdfs(
  parts: readonly CombinePart[],
  { onProgress, signal }: CombineOptions = {}
): Promise<CombineResult> {
  const combined = await PDFDocument.create();
  const skipped: string[] = [];

  for (const [index, part] of parts.entries()) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress?.(index + 1, parts.length, part.label);

    try {
      // Slide decks arrive with a lot of embedded imagery, and parsing every
      // piece of metadata on top of that is time the reader can feel.
      const source = await PDFDocument.load(part.bytes, { updateMetadata: false });
      const copied = await combined.copyPages(source, source.getPageIndices());
      for (const page of copied) combined.addPage(page);
    } catch {
      skipped.push(part.label);
    }

    // Let the browser paint between documents; without this the progress the
    // caller just set never reaches the screen.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (combined.getPageCount() === 0) {
    throw new Error('None of the converted documents could be combined.');
  }

  // Object streams stay ON. Turning them off looked like an optimisation and is
  // the opposite in a browser: measured on a real lecture deck, saving one
  // document took 1.2 s with them and 8.0 s without, and two took over two
  // minutes. Node shows almost no difference, which is why this had to be
  // measured where it actually runs.
  //
  // No copy of the result: pdf-lib hands back a buffer it does not reuse, and
  // duplicating a megabyte at the moment memory is highest helps nobody.
  const bytes = await combined.save();

  return { bytes, pages: combined.getPageCount(), skipped };
}
