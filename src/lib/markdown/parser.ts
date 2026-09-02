/**
 * Lightweight, dependency-free Markdown tokenizer.
 * Converts markdown text into structured blocks and inline runs suitable for PDF rendering.
 */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; runs: InlineRun[] }
  | { type: 'paragraph'; text: string; runs: InlineRun[] }
  | { type: 'code_block'; language: string; code: string }
  | { type: 'blockquote'; lines: string[]; runs: InlineRun[] }
  | { type: 'list'; ordered: boolean; items: { runs: InlineRun[]; raw: string }[] }
  | { type: 'task_list'; items: { checked: boolean; runs: InlineRun[]; raw: string }[] }
  | { type: 'table'; headers: string[]; alignments: ('left' | 'center' | 'right')[]; rows: string[][] }
  | { type: 'horizontal_rule' };

/**
 * Parses inline formatting: bold, italic, code, links.
 */
export function parseInlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let remaining = text;

  // Regex to match inline tokens:
  // 1: `code`
  // 2: **bold** or __bold__
  // 3: *italic* or _italic_
  // 4: [link](url)
  const tokenRegex = /(`([^`]+)`)|(\*\*([^*]+)\*\*|__([^_]+)__)|(\*([^*]+)\*|_([^_]+)_)|(\[([^\]]+)\]\(([^)]+)\))/;

  while (remaining.length > 0) {
    const match = tokenRegex.exec(remaining);
    if (!match) {
      runs.push({ text: remaining });
      break;
    }

    const index = match.index;
    if (index > 0) {
      runs.push({ text: remaining.slice(0, index) });
    }

    const [fullMatch] = match;

    if (match[1]) {
      // Inline code: `code`
      runs.push({ text: match[2], code: true });
    } else if (match[3]) {
      // Bold: **bold** or __bold__
      const boldText = match[4] || match[5];
      runs.push({ text: boldText, bold: true });
    } else if (match[6]) {
      // Italic: *italic* or _italic_
      const italicText = match[7] || match[8];
      runs.push({ text: italicText, italic: true });
    } else if (match[9]) {
      // Link: [text](url)
      const linkText = match[10];
      const linkUrl = match[11];
      runs.push({ text: linkText, link: linkUrl });
    }

    remaining = remaining.slice(index + fullMatch.length);
  }

  return runs.filter((run) => run.text.length > 0);
}

/**
 * Tokenizes a Markdown string into a sequence of structural blocks.
 */
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal Rule: ---, ***, ___
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'horizontal_rule' });
      i++;
      continue;
    }

    // Fenced Code Block: ``` or ~~~
    const codeMatch = /^(?:```|~~~)(\w*)/.exec(trimmed);
    if (codeMatch) {
      const language = codeMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^(?:```|~~~)/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push({
        type: 'code_block',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // Heading: # H1 to ###### H6
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = headingMatch[2].trim();
      blocks.push({
        type: 'heading',
        level,
        text,
        runs: parseInlineRuns(text),
      });
      i++;
      continue;
    }

    // Blockquote: lines starting with >
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const combined = quoteLines.join(' ');
      blocks.push({
        type: 'blockquote',
        lines: quoteLines,
        runs: parseInlineRuns(combined),
      });
      continue;
    }

    // Table: starts with | and next line is delimiter |---|---|
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?(\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1].trim())) {
      const headers = trimmed
        .split('|')
        .slice(1, -1)
        .map((h) => h.trim());
      const delimiterCells = lines[i + 1]
        .trim()
        .split('|')
        .slice(1, -1)
        .map((d) => d.trim());
      const alignments: ('left' | 'center' | 'right')[] = delimiterCells.map((cell) => {
        if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
        if (cell.endsWith(':')) return 'right';
        return 'left';
      });

      i += 2; // skip header and delimiter
      const rows: string[][] = [];

      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const rowCells = lines[i]
          .trim()
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        rows.push(rowCells);
        i++;
      }

      blocks.push({
        type: 'table',
        headers,
        alignments,
        rows,
      });
      continue;
    }

    // Task list: - [ ] or - [x]
    if (/^[-*+]\s+\[([ xX])\]\s+(.*)$/.test(trimmed)) {
      const taskItems: { checked: boolean; runs: InlineRun[]; raw: string }[] = [];
      while (i < lines.length) {
        const m = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        const checked = m[1].toLowerCase() === 'x';
        const raw = m[2].trim();
        taskItems.push({
          checked,
          raw,
          runs: parseInlineRuns(raw),
        });
        i++;
      }
      blocks.push({
        type: 'task_list',
        items: taskItems,
      });
      continue;
    }

    // Unordered List: - item, * item, + item
    if (/^[-*+]\s+(.*)$/.test(trimmed)) {
      const items: { runs: InlineRun[]; raw: string }[] = [];
      while (i < lines.length) {
        const m = /^[-*+]\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        const raw = m[1].trim();
        items.push({
          raw,
          runs: parseInlineRuns(raw),
        });
        i++;
      }
      blocks.push({
        type: 'list',
        ordered: false,
        items,
      });
      continue;
    }

    // Ordered List: 1. item, 2. item
    if (/^\d+\.\s+(.*)$/.test(trimmed)) {
      const items: { runs: InlineRun[]; raw: string }[] = [];
      while (i < lines.length) {
        const m = /^\d+\.\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        const raw = m[1].trim();
        items.push({
          raw,
          runs: parseInlineRuns(raw),
        });
        i++;
      }
      blocks.push({
        type: 'list',
        ordered: true,
        items,
      });
      continue;
    }

    // Regular Paragraph: collect continuous lines until blank or special block
    const paragraphLines: string[] = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|~~~|>|[-*+]\s|\d+\.\s|\||---|___|\*\*\*)/.test(lines[i].trim())
    ) {
      paragraphLines.push(lines[i].trim());
      i++;
    }

    const fullText = paragraphLines.join(' ');
    blocks.push({
      type: 'paragraph',
      text: fullText,
      runs: parseInlineRuns(fullText),
    });
  }

  return blocks;
}
