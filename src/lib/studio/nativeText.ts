import { PDFDict, PDFName, type PDFPage } from 'pdf-lib';
import { parseOperations } from '@/lib/pdf/contentStream';
import { readPageStream } from '@/lib/pdf/pageText';
import { readPageFonts } from '@/lib/pdf/fontMap';
import { multiply, scanText, type ScannedText } from '@/lib/pdf/textScan';
import { applyPlans, findOccurrences, planReplacement, type Occurrence } from '@/lib/pdf/replaceText';
import type { TextRewrite } from '@/lib/studio/script';

export function matchesTextTarget(scan: ScannedText, occurrence: Occurrence, target: NonNullable<TextRewrite['target']>): boolean {
  const run = scan.runs[occurrence.run];
  const glyph = run.glyphs[occurrence.firstGlyph];
  const transform = multiply(run.matrix, run.ctm);
  const size = Math.abs(run.size) * Math.hypot(transform[2], transform[3]);
  return !!glyph && run.renderMode === 0 && run.font?.baseFont === target.font
    && Math.hypot(glyph.x - target.x, glyph.y - target.y) < 0.75
    && Math.abs(size - target.size) < 0.05;
}

/** Strict on-page replacement. No partial output if the target or glyphs cannot
 * be proved. Never edits Form XObjects by confusing their text with page text.
 */
export function rewriteSelectedNative(page: PDFPage, rewrite: TextRewrite): void {
  if (!rewrite.target) throw new Error('native-text:ambiguous');
  const streams = readPageStream(page, { strict: true });
  const operations = parseOperations(streams.bytes);
  if (operations.some(op => op.inlineImage)) throw new Error('native-text:unsupported-operator');
  const states = page.node.Resources()?.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
  if (states?.entries().some(([, value]) => {
    const state = page.node.context.lookupMaybe(value, PDFDict);
    return state?.has(PDFName.Font);
  })) throw new Error('native-text:unsupported-operator');
  const scan = scanText(operations, readPageFonts(page.node.Resources()));
  const found = findOccurrences(scan, rewrite.needle).filter(hit => matchesTextTarget(scan, hit, rewrite.target!));
  if (found.length !== 1) throw new Error('native-text:ambiguous');
  const plan = planReplacement(scan, operations, found[0], rewrite.replacement, {
    fit: rewrite.fit, sizeRatio: rewrite.sizeRatio, color: rewrite.color,
  });
  if (!plan.ok) throw new Error(`native-text:${plan.reason}${plan.missing.length ? `: ${plan.missing.join(' ')}` : ''}`);
  // Detach this page instead of mutating a shared content stream. Materialize's
  // reachability pass removes old bytes only when no other page needs them.
  page.node.set(PDFName.of('Contents'), page.node.context.register(
    page.node.context.flateStream(applyPlans(streams.bytes, [plan])),
  ));
}
