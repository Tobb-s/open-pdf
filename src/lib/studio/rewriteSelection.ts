/**
 * Turning a panel full of ticked checkboxes into a set of pages to rewrite.
 *
 * Small enough to look obviously right and important enough to be wrong
 * quietly, which is the combination that earns a test. The rewrite works a
 * whole page at a time — it is given a word and told to replace every match on
 * the page — so a reader who unticked one of three matches on a page must not
 * get all three replaced.
 *
 * The alternative would be to number the matches and replace the third one, and
 * it was considered and refused. The panel finds its matches with pdf.js and
 * the rewrite finds its own with its own reader; asking them to agree on the
 * order of matches within a page is a bet, and the way that bet loses is the
 * wrong word being replaced in a document the reader then sends. Refusing a
 * partial selection costs a click and cannot be wrong.
 */

export interface SelectableHit {
  /** Whatever identifies the hit in the panel's selection set. */
  key: string;
  /** The page it sits on. */
  page: string;
}

export type RewriteSelection =
  /** Every match on each of these pages was selected; the rewrite can proceed. */
  | { kind: 'pages'; pages: string[] }
  /** Some matches on a page were left out, so the rewrite cannot say which. */
  | { kind: 'partial'; pages: string[] }
  /** Nothing was selected. */
  | { kind: 'none' };

export function selectionToPages(
  hits: readonly SelectableHit[],
  selected: ReadonlySet<string>
): RewriteSelection {
  const counts = new Map<string, { total: number; chosen: number }>();
  for (const hit of hits) {
    const entry = counts.get(hit.page) ?? { total: 0, chosen: 0 };
    entry.total += 1;
    if (selected.has(hit.key)) entry.chosen += 1;
    counts.set(hit.page, entry);
  }

  const touched = [...counts.entries()].filter(([, entry]) => entry.chosen > 0);
  if (touched.length === 0) return { kind: 'none' };

  const incomplete = touched
    .filter(([, entry]) => entry.chosen !== entry.total)
    .map(([page]) => page);
  if (incomplete.length > 0) return { kind: 'partial', pages: incomplete };

  return { kind: 'pages', pages: touched.map(([page]) => page) };
}
