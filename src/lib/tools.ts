/**
 * The catalogue of tools: which ones exist, in what order, and what colour each
 * one wears. Every user-visible string lives in the dictionaries instead, so a
 * tool cannot exist in one language and be missing from the other.
 */

export type ToolSlug =
  | 'compress'
  | 'ocr'
  | 'merge'
  | 'split'
  | 'organize'
  | 'pdf-to-word'
  | 'edit'
  | 'fill-form'
  | 'image-pdf'
  | 'office-to-pdf'
  | 'watermark'
  | 'page-numbers'
  | 'batch'
  | 'markdown'
  | 'studio';

export interface Tool {
  slug: ToolSlug;
  color: string;
  bgColor: string;
  /**
   * Link to this tool with a plain anchor instead of a client-side transition.
   *
   * Cross-origin isolation comes from headers on the document response, and a
   * client-side route change never fetches a new document — so arriving at the
   * converter by clicking a link left it without `SharedArrayBuffer`, and the
   * page wrongly blamed the browser.
   */
  needsFreshDocument?: boolean;
}

export const TOOLS: Tool[] = [
  { slug: 'compress', color: 'text-amber-600', bgColor: 'bg-amber-50' },
  { slug: 'ocr', color: 'text-orange-500', bgColor: 'bg-orange-50' },
  { slug: 'merge', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  { slug: 'split', color: 'text-red-500', bgColor: 'bg-red-50' },
  { slug: 'organize', color: 'text-emerald-500', bgColor: 'bg-emerald-50' },
  { slug: 'pdf-to-word', color: 'text-indigo-500', bgColor: 'bg-indigo-50' },
  { slug: 'edit', color: 'text-purple-500', bgColor: 'bg-purple-50' },
  { slug: 'fill-form', color: 'text-teal-500', bgColor: 'bg-teal-50' },
  { slug: 'office-to-pdf', color: 'text-sky-600', bgColor: 'bg-sky-50', needsFreshDocument: true },
  { slug: 'image-pdf', color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
  { slug: 'watermark', color: 'text-rose-500', bgColor: 'bg-rose-50' },
  { slug: 'page-numbers', color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
  { slug: 'markdown', color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
  { slug: 'batch', color: 'text-fuchsia-600', bgColor: 'bg-fuchsia-50' },
  { slug: 'studio', color: 'text-violet-600', bgColor: 'bg-violet-50' },
];

export const TOOL_SLUGS = TOOLS.map((tool) => tool.slug);

/** The editor: the one entry that is a product rather than a task. */
export const STUDIO: ToolSlug = 'studio';

/**
 * OpenPDF Tools — the single-task tools, as a family.
 *
 * Studio is left out on purpose. The front page and the navigation present the
 * editor as what it is rather than as the thirteenth card in a grid of equals,
 * and this is the list they iterate over to do that. `TOOLS` stays the whole
 * catalogue: routes, redirects and the search still cover everything.
 */
export const TOOLBOX: Tool[] = TOOLS.filter((tool) => tool.slug !== STUDIO);
