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
  | 'image-pdf';

export interface Tool {
  slug: ToolSlug;
  color: string;
  bgColor: string;
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
  { slug: 'image-pdf', color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
];

export const TOOL_SLUGS = TOOLS.map((tool) => tool.slug);
