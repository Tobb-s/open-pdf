import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseInlineRuns } from '@/lib/markdown/parser';
import { mergeMarkdownFiles, titleFromFilename, countMarkdownStats } from '@/lib/markdown/merge';
import { renderMarkdownToPdf } from '@/lib/markdown/pdfRenderer';
import { PDFDocument } from 'pdf-lib';

describe('Markdown Parser', () => {
  it('parses headings with levels and inline runs', () => {
    const md = '# Main Title\n\n## Subtitle with **bold** and `code`';
    const blocks = parseMarkdown(md);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: 'heading',
      level: 1,
      text: 'Main Title',
    });
    expect(blocks[1]).toMatchObject({
      type: 'heading',
      level: 2,
    });
    if (blocks[1].type === 'heading') {
      expect(blocks[1].runs.some((r) => r.bold)).toBe(true);
      expect(blocks[1].runs.some((r) => r.code)).toBe(true);
    }
  });

  it('parses fenced code blocks with language', () => {
    const md = '```typescript\nconst a = 1;\nconsole.log(a);\n```';
    const blocks = parseMarkdown(md);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'code_block',
      language: 'typescript',
      code: 'const a = 1;\nconsole.log(a);',
    });
  });

  it('parses lists and task lists', () => {
    const md = '- Item 1\n- Item 2\n- [ ] Task incomplete\n- [x] Task done';
    const blocks = parseMarkdown(md);

    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('parses tables', () => {
    const md = '| Name | Age |\n|---|---|\n| Alice | 30 |\n| Bob | 25 |';
    const blocks = parseMarkdown(md);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('table');
    if (blocks[0].type === 'table') {
      expect(blocks[0].headers).toEqual(['Name', 'Age']);
      expect(blocks[0].rows).toHaveLength(2);
      expect(blocks[0].rows[0]).toEqual(['Alice', '30']);
    }
  });

  it('parses blockquotes and horizontal rules', () => {
    const md = '> Important note\n\n---';
    const blocks = parseMarkdown(md);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('blockquote');
    expect(blocks[1].type).toBe('horizontal_rule');
  });

  it('extracts inline styles correctly', () => {
    const runs = parseInlineRuns('Hello **World** with *italic* and `code` and [link](https://test.com)');
    expect(runs.some((r) => r.text === 'World' && r.bold)).toBe(true);
    expect(runs.some((r) => r.text === 'italic' && r.italic)).toBe(true);
    expect(runs.some((r) => r.text === 'code' && r.code)).toBe(true);
    expect(runs.some((r) => r.text === 'link' && r.link === 'https://test.com')).toBe(true);
  });
});

describe('Markdown Merge', () => {
  it('cleans titles from filenames', () => {
    expect(titleFromFilename('01_guia-rapida.md')).toBe('01 guia rapida');
    expect(titleFromFilename('capitulo-dos.markdown')).toBe('capitulo dos');
  });

  it('counts words and lines correctly', () => {
    const text = 'Hello world\nThis is a test of OpenPDF';
    const stats = countMarkdownStats(text);
    expect(stats.lines).toBe(2);
    expect(stats.words).toBe(8);
  });

  it('merges multiple files with dividers and titles', () => {
    const files = [
      { id: '1', name: 'intro.md', content: 'Introducción al proyecto.', size: 25 },
      { id: '2', name: 'usage.md', content: 'Modo de uso.', size: 12 },
    ];

    const { content, stats } = mergeMarkdownFiles(files, { separator: 'divider', addTitleHeading: true });
    expect(stats.filesCount).toBe(2);
    expect(content).toContain('Introducción al proyecto.');
    expect(content).toContain('Modo de uso.');
    expect(content).toContain('---');
  });
});

describe('Markdown to PDF Vector Renderer', () => {
  it('generates a valid PDF document with pages and text', async () => {
    const sampleMarkdown = `
# Documento de Prueba

Este es un párrafo de ejemplo con **texto en negrita**, *cursiva* y \`código en línea\`.

## Subtítulo 2

> Una cita inspiradora sobre la privacidad local y el software abierto.

\`\`\`javascript
function saludar() {
  console.log("Hola OpenPDF!");
}
\`\`\`

| Característica | Estado |
|---|---|
| Privacidad | 100% |
| Velocidad | Máxima |

- Elemento de lista A
- Elemento de lista B
- [x] Tarea completa
`;

    const pdfBytes = await renderMarkdownToPdf([{ content: sampleMarkdown }], {
      pageSize: 'A4',
      showPageNumbers: true,
      documentTitle: 'Reporte de Prueba',
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);

    // Verify the produced bytes can be parsed by pdf-lib as a valid PDF
    const parsedPdf = await PDFDocument.load(pdfBytes);
    expect(parsedPdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('supports page breaks per file when merging', async () => {
    const files = [
      { name: 'file1.md', content: '# Capítulo 1\n\nContenido uno.' },
      { name: 'file2.md', content: '# Capítulo 2\n\nContenido dos.' },
    ];

    const pdfBytes = await renderMarkdownToPdf(files, {
      pageBreakPerFile: true,
    });

    const parsedPdf = await PDFDocument.load(pdfBytes);
    expect(parsedPdf.getPageCount()).toBe(2);
  });
});
