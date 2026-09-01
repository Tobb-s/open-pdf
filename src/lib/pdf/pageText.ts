import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib';
import { parseOperations } from '@/lib/pdf/contentStream';
import { readPageFonts } from '@/lib/pdf/fontMap';
import { scanText, type ScannedText } from '@/lib/pdf/textScan';
import {
  applyPlans,
  findOccurrences,
  planReplacement,
  type FindOptions,
  type Occurrence,
  type PlanOptions,
  type PlannedEdit,
  type RefusalReason,
} from '@/lib/pdf/replaceText';

/**
 * Reading and rewriting the text of a whole document.
 *
 * The piece that turns three parsers into something a tool can call. It also
 * owns the one decision that is easy to get quietly wrong: where the new
 * content stream goes.
 *
 * A page's `/Contents` may be one stream or an array of them, and the obvious
 * move — build the new bytes and register them as a new object — leaves the old
 * object in the file. pdf-lib has no garbage collection, so nothing removes it:
 * the document would render the new word and still contain the old one, findable
 * by anyone who looked at the bytes. For a replacement that is a defect on its
 * own; for a name someone meant to remove it is the whole problem.
 *
 * So the streams are overwritten at their own references. The array keeps its
 * shape, the first stream carries the edited content, and the rest are emptied.
 */

export interface PageStreams {
  /** Every content stream of the page, joined as a viewer would read them. */
  bytes: Uint8Array;
  /** The references they came from, in order. */
  refs: PDFRef[];
}

/** Joins a page's content streams into the single sequence a viewer sees. */
export function readPageStream(page: PDFPage): PageStreams {
  const contents = page.node.Contents();
  const refs: PDFRef[] = [];
  const parts: Uint8Array[] = [];

  const take = (value: unknown, ref: PDFRef | null) => {
    const stream = page.node.context.lookup(value as never);
    if (!(stream instanceof PDFRawStream)) return;
    try {
      parts.push(decodePDFRawStream(stream).decode());
      if (ref) refs.push(ref);
    } catch {
      // A stream with a filter this build cannot decode is a stream whose text
      // cannot be edited. It still has to occupy its place in the sequence, or
      // every byte offset after it would be wrong.
      parts.push(new Uint8Array());
      if (ref) refs.push(ref);
    }
  };

  if (contents instanceof PDFArray) {
    for (let index = 0; index < contents.size(); index += 1) {
      const entry = contents.get(index);
      take(entry, entry instanceof PDFRef ? entry : null);
    }
  } else {
    const entry = page.node.get(PDFName.of('Contents'));
    take(contents, entry instanceof PDFRef ? entry : null);
  }

  // A newline between streams, exactly as the specification says a viewer must
  // treat them: without it the last operator of one and the first of the next
  // would run together into a token that is neither.
  const total = parts.reduce((sum, part) => sum + part.length + 1, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
    bytes[at] = 0x0a;
    at += 1;
  }
  return { bytes, refs };
}

/** Writes edited content back over the streams it came from, leaving no copy behind. */
export function writePageStream(page: PDFPage, streams: PageStreams, bytes: Uint8Array): void {
  const context = page.node.context;
  if (streams.refs.length === 0) {
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(bytes)));
    return;
  }
  context.assign(streams.refs[0], context.flateStream(bytes));
  for (const ref of streams.refs.slice(1)) {
    context.assign(ref, context.flateStream(new Uint8Array()));
  }
}

/** Everything one page's text amounts to, ready to search. */
export function scanPageText(page: PDFPage): { scan: ScannedText; streams: PageStreams } {
  const streams = readPageStream(page);
  const operations = parseOperations(streams.bytes);
  return { scan: scanText(operations, readPageFonts(page.node.Resources())), streams };
}

export interface PageResult {
  page: number;
  /** Occurrences found, whether or not they could be rewritten. */
  found: number;
  /** Occurrences actually rewritten. */
  replaced: number;
  /** Why the rest were not, counted by reason. */
  refused: Partial<Record<RefusalReason, number>>;
  /** The characters no font on this page could draw, if that was the obstacle. */
  missing: string[];
  /** The largest distortion applied, as a percentage away from unscaled. */
  worstScale: number;
}

export interface ReplaceReport {
  pages: PageResult[];
  found: number;
  replaced: number;
  refused: Partial<Record<RefusalReason, number>>;
  missing: string[];
}

export interface ReplaceOptions extends FindOptions, PlanOptions {
  /** Restrict to these page indices. Every page when absent. */
  pages?: readonly number[];
  /** Stop after this many replacements. */
  limit?: number;
}

/**
 * Replaces a phrase throughout a document by rewriting the operators that draw
 * it, and reports every occurrence it could not rewrite and why.
 *
 * The report is not decoration. A run that replaced eleven of thirteen names is
 * a run that left two, and a caller that shows «done» after it has misled
 * someone about a document they are going to send.
 */
export async function replaceEverywhere(
  source: Uint8Array,
  needle: string,
  replacement: string,
  options: ReplaceOptions = {}
): Promise<{ bytes: Uint8Array; report: ReplaceReport }> {
  const document = await PDFDocument.load(source, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pages = document.getPages();
  const report: ReplaceReport = { pages: [], found: 0, replaced: 0, refused: {}, missing: [] };
  let done = 0;

  for (const [index, page] of pages.entries()) {
    if (options.pages && !options.pages.includes(index)) continue;

    const { scan, streams } = scanPageText(page);
    const operations = parseOperations(streams.bytes);
    const occurrences = findOccurrences(scan, needle, options);
    if (occurrences.length === 0) continue;

    const result: PageResult = {
      page: index,
      found: occurrences.length,
      replaced: 0,
      refused: {},
      missing: [],
      worstScale: 100,
    };
    const planned: PlannedEdit[] = [];

    for (const occurrence of occurrences) {
      if (options.limit !== undefined && done >= options.limit) break;
      const plan = planReplacement(scan, operations, occurrence, replacement, options);
      if (!plan.ok) {
        result.refused[plan.reason] = (result.refused[plan.reason] ?? 0) + 1;
        for (const character of plan.missing) {
          if (!result.missing.includes(character)) result.missing.push(character);
        }
        continue;
      }
      planned.push(plan);
      done += 1;
      result.replaced += 1;
      if (Math.abs(plan.horizontalScale - 100) > Math.abs(result.worstScale - 100)) {
        result.worstScale = plan.horizontalScale;
      }
    }

    if (planned.length > 0) {
      // Two occurrences inside one show operator would each rewrite the whole
      // operator, and the second would undo the first. Taking the earlier one
      // and reporting the rest is the only answer that cannot corrupt a page.
      const seen = new Set<number>();
      const disjoint = planned.filter((plan) => {
        const operation = scan.runs[plan.occurrence.run].operation;
        if (seen.has(operation)) {
          result.refused.split = (result.refused.split ?? 0) + 1;
          result.replaced -= 1;
          done -= 1;
          return false;
        }
        seen.add(operation);
        return true;
      });
      if (disjoint.length > 0) {
        writePageStream(page, streams, applyPlans(streams.bytes, disjoint));
      }
    }

    report.pages.push(result);
  }

  for (const page of report.pages) {
    report.found += page.found;
    report.replaced += page.replaced;
    for (const [reason, count] of Object.entries(page.refused)) {
      const key = reason as RefusalReason;
      report.refused[key] = (report.refused[key] ?? 0) + (count ?? 0);
    }
    for (const character of page.missing) {
      if (!report.missing.includes(character)) report.missing.push(character);
    }
  }

  return { bytes: (await document.save()).slice(), report };
}

/** Finds a phrase across a document without changing anything. */
export async function findEverywhere(
  source: Uint8Array,
  needle: string,
  options: FindOptions & { pages?: readonly number[] } = {}
): Promise<Array<Occurrence & { page: number }>> {
  const document = await PDFDocument.load(source, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const out: Array<Occurrence & { page: number }> = [];
  for (const [index, page] of document.getPages().entries()) {
    if (options.pages && !options.pages.includes(index)) continue;
    const { scan } = scanPageText(page);
    for (const occurrence of findOccurrences(scan, needle, options)) {
      out.push({ ...occurrence, page: index });
    }
  }
  return out;
}
