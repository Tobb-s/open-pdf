/**
 * One description of every tool, used by the home page, the navigation bar, the
 * sitemap and each route's page metadata — so a new tool cannot appear in one
 * place and be missing from another.
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
  /** Card and page heading. */
  title: string;
  /** Short label for the navigation bar. */
  navLabel: string;
  /** One line, shown on the card. */
  tagline: string;
  /** Sentence used as the page's meta description. */
  description: string;
  /** Extra terms the home-page search should match. */
  keywords: string[];
  color: string;
  bgColor: string;
}

export const TOOLS: Tool[] = [
  {
    slug: 'compress',
    title: 'Compress PDF',
    navLabel: 'Compress',
    tagline: 'Make a PDF smaller by re-encoding its pages.',
    description:
      'Reduce the size of a PDF in your browser. Choose how hard to compress, and see the result before you download anything.',
    keywords: ['reduce', 'size', 'smaller', 'shrink', 'optimise'],
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
  },
  {
    slug: 'ocr',
    title: 'OCR PDF',
    navLabel: 'OCR',
    tagline: 'Read the text off a scan and make it searchable.',
    description:
      'Recognise the text in a scanned PDF and get back a copy you can search and select, plus the plain text. Runs entirely on your device.',
    keywords: ['scan', 'scanned', 'recognise', 'recognize', 'searchable', 'text'],
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
  },
  {
    slug: 'merge',
    title: 'Merge PDF',
    navLabel: 'Merge',
    tagline: 'Combine several PDFs into one document.',
    description:
      'Join several PDF files into a single document, in the order you choose, without uploading anything.',
    keywords: ['combine', 'join', 'append', 'concatenate'],
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  {
    slug: 'split',
    title: 'Split PDF',
    navLabel: 'Split',
    tagline: 'Pull out pages, or break every page apart.',
    description:
      'Extract a range of pages from a PDF, or split every page into its own file, directly in your browser.',
    keywords: ['extract', 'pages', 'range', 'separate', 'divide'],
    color: 'text-red-500',
    bgColor: 'bg-red-50',
  },
  {
    slug: 'organize',
    title: 'Organize PDF',
    navLabel: 'Organize',
    tagline: 'Reorder, rotate and remove pages.',
    description:
      'Rearrange the pages of a PDF, rotate them, and drop the ones you do not need — with a preview of every page.',
    keywords: ['reorder', 'rotate', 'delete', 'rearrange', 'sort'],
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-50',
  },
  {
    slug: 'pdf-to-word',
    title: 'PDF to Word',
    navLabel: 'PDF to Word',
    tagline: 'Extract the text into an editable .docx.',
    description:
      'Turn the text of a PDF into an editable Word document. Text only — images, tables and layout are not carried over.',
    keywords: ['docx', 'word', 'convert', 'text', 'editable'],
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-50',
  },
  {
    slug: 'edit',
    title: 'Edit PDF',
    navLabel: 'Edit',
    tagline: 'Add text anywhere on a page.',
    description:
      'Place text on any page of a PDF and save a new copy, with the page in front of you as you work.',
    keywords: ['annotate', 'text', 'write', 'add', 'sign'],
    color: 'text-purple-500',
    bgColor: 'bg-purple-50',
  },
  {
    slug: 'fill-form',
    title: 'Fill Form',
    navLabel: 'Fill Form',
    tagline: 'Complete an interactive PDF form.',
    description:
      'Fill in the interactive fields of a PDF form and download the completed document, without sending it anywhere.',
    keywords: ['form', 'fields', 'complete', 'acroform', 'input'],
    color: 'text-teal-500',
    bgColor: 'bg-teal-50',
  },
  {
    slug: 'image-pdf',
    title: 'Images & PDF',
    navLabel: 'Images',
    tagline: 'Convert pages to JPG, or images to a PDF.',
    description:
      'Turn every page of a PDF into a JPG image, or combine JPG, PNG and WebP images into a single PDF.',
    keywords: ['jpg', 'jpeg', 'png', 'webp', 'image', 'photo', 'picture', 'convert'],
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
  },
];

export const TOOL_BY_SLUG = new Map(TOOLS.map((tool) => [tool.slug, tool]));

export function toolMetadata(slug: ToolSlug) {
  const tool = TOOL_BY_SLUG.get(slug);
  if (!tool) throw new Error(`Unknown tool: ${slug}`);
  return {
    title: `${tool.title} — free, in your browser | OpenPDF`,
    description: tool.description,
    alternates: { canonical: `/${tool.slug}` },
    openGraph: {
      title: `${tool.title} | OpenPDF`,
      description: tool.description,
      url: `/${tool.slug}`,
      type: 'website' as const,
    },
  };
}
