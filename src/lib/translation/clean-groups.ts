import type { CleanPage } from './clean-contract';
import { buildTranslationContext } from './context';
import type { Segment } from './contracts';
import type { TranslationPage } from './layout';
export interface CleanTextGroup { id: string; text: string; parts: { page: number; element: number }[] }
/** Only adjacent body paragraphs at a source-page boundary can join. Figures/headings/notes are barriers. */
export function cleanTextGroups(pages: CleanPage[]): CleanTextGroup[] {
  const groups: CleanTextGroup[] = [];
  let previous: { page: number; element: number; kind: string } | undefined;
  for (const p of pages) for (let i = 0; i < p.elements.length; i++) {
    const e = p.elements[i];
    if (e.kind === 'noise') continue;
    if (e.kind === 'figure') { previous = undefined; continue; }
    const prior = groups.at(-1);
    const join = prior && previous?.kind === 'paragraph' && e.kind === 'paragraph' && previous.page === p.number - 1 &&
      !/[.!?…]["'”’»)\]¹²³⁴⁵⁶⁷⁸⁹⁰]*$/.test(prior.text.trim());
    if (join) { prior.text += ' ' + e.text; prior.parts.push({ page: p.number, element: i }); }
    else groups.push({ id: `c${p.number}_${i}`, text: e.text, parts: [{ page: p.number, element: i }] });
    previous = { page: p.number, element: i, kind: e.kind };
  }
  return groups;
}
export function cleanTranslationContext(pages: CleanPage[], targets: Segment[]) {
  const groups = cleanTextGroups(pages);
  const contextPage: TranslationPage = { number: 1, width: 1, height: 1, method: 'native', warnings: [], blocks: groups.map(g => {
    const first = g.parts[0], e = pages[first.page - 1].elements[first.element];
    return { id: g.id, source: g.text, translated: e.translated, included: true, x: 0, y: 0, width: 1, height: 1, size: 12, font: 'DejaVuSans', lines: [] };
  }) };
  return buildTranslationContext([contextPage], targets);
}
