import {
  PDFDocument,
  PDFFont,
  PDFPage,
  PageSizes,
  StandardFonts,
  rgb,
  RGB,
} from 'pdf-lib';
import { parseMarkdown, type InlineRun, type MarkdownBlock } from './parser';

export type PageSizeName = 'A4' | 'Letter';
export type TypographyTheme = 'sans' | 'serif';

export interface MarkdownPdfOptions {
  pageSize?: PageSizeName;
  theme?: TypographyTheme;
  pageBreakPerFile?: boolean;
  showPageNumbers?: boolean;
  documentTitle?: string;
  marginPt?: number;
}

interface RenderContext {
  doc: PDFDocument;
  pages: PDFPage[];
  currentPage: PDFPage;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  contentWidth: number;
  cursorY: number;
  bottomLimit: number;
  regularFont: PDFFont;
  boldFont: PDFFont;
  italicFont: PDFFont;
  codeFont: PDFFont;
  primaryColor: RGB;
  textColor: RGB;
  mutedColor: RGB;
  borderColor: RGB;
  bgCodeColor: RGB;
}

const COLORS = {
  text: rgb(0.12, 0.14, 0.17),
  primary: rgb(0.08, 0.38, 0.74),
  muted: rgb(0.45, 0.48, 0.52),
  border: rgb(0.85, 0.88, 0.91),
  bgCode: rgb(0.96, 0.97, 0.98),
  blockquoteBar: rgb(0.2, 0.45, 0.75),
};

function ensureSpace(ctx: RenderContext, neededPt: number): void {
  if (ctx.cursorY - neededPt < ctx.bottomLimit) {
    addNewPage(ctx);
  }
}

function addNewPage(ctx: RenderContext): void {
  const page = ctx.doc.addPage([ctx.pageWidth, ctx.pageHeight]);
  ctx.pages.push(page);
  ctx.currentPage = page;
  ctx.cursorY = ctx.pageHeight - ctx.margin;
}

/**
 * Calculates wrapped lines for a paragraph with plain text runs.
 */
function wrapRuns(
  runs: InlineRun[],
  maxWidth: number,
  regularFont: PDFFont,
  boldFont: PDFFont,
  italicFont: PDFFont,
  codeFont: PDFFont,
  fontSize: number
): { runs: { text: string; font: PDFFont; color?: RGB }[]; width: number }[] {
  const wordsWithStyle: { word: string; font: PDFFont; color?: RGB; hasSpaceAfter: boolean }[] = [];

  for (const run of runs) {
    let font = regularFont;
    if (run.bold) font = boldFont;
    else if (run.italic) font = italicFont;
    else if (run.code) font = codeFont;

    const color = run.link ? COLORS.primary : undefined;
    const parts = run.text.split(/(\s+)/);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (/^\s+$/.test(part)) continue;

      const hasSpace = i + 1 < parts.length && /^\s+$/.test(parts[i + 1]);
      wordsWithStyle.push({
        word: part,
        font,
        color,
        hasSpaceAfter: hasSpace,
      });
    }
  }

  if (wordsWithStyle.length === 0) {
    return [];
  }

  const lines: { runs: { text: string; font: PDFFont; color?: RGB }[]; width: number }[] = [];
  let currentRuns: { text: string; font: PDFFont; color?: RGB }[] = [];
  let currentLineWidth = 0;

  for (const item of wordsWithStyle) {
    const wordWidth = item.font.widthOfTextAtSize(item.word, fontSize);
    const spaceWidth = item.font.widthOfTextAtSize(' ', fontSize);
    const needed = currentLineWidth === 0 ? wordWidth : currentLineWidth + spaceWidth + wordWidth;

    if (needed > maxWidth && currentLineWidth > 0) {
      lines.push({ runs: currentRuns, width: currentLineWidth });
      currentRuns = [{ text: item.word, font: item.font, color: item.color }];
      currentLineWidth = wordWidth;
    } else {
      if (currentRuns.length > 0) {
        currentRuns.push({ text: ' ', font: item.font });
        currentLineWidth += spaceWidth;
      }
      currentRuns.push({ text: item.word, font: item.font, color: item.color });
      currentLineWidth += wordWidth;
    }
  }

  if (currentRuns.length > 0) {
    lines.push({ runs: currentRuns, width: currentLineWidth });
  }

  return lines;
}

/**
 * Renders a list of markdown blocks onto the PDF document.
 */
function renderBlocks(ctx: RenderContext, blocks: MarkdownBlock[]): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const sizes: Record<number, { size: number; spacingTop: number; spacingBottom: number }> = {
          1: { size: 22, spacingTop: 18, spacingBottom: 10 },
          2: { size: 17, spacingTop: 14, spacingBottom: 8 },
          3: { size: 14, spacingTop: 12, spacingBottom: 6 },
          4: { size: 12, spacingTop: 10, spacingBottom: 5 },
          5: { size: 11, spacingTop: 8, spacingBottom: 4 },
          6: { size: 10, spacingTop: 8, spacingBottom: 4 },
        };

        const config = sizes[block.level] || sizes[2];
        // Prevent orphaned headings by requiring space for heading + 2 lines of text
        ensureSpace(ctx, config.spacingTop + config.size + config.spacingBottom + 30);

        ctx.cursorY -= config.spacingTop;
        const font = ctx.boldFont;
        const headingLines = wrapRuns(
          [{ text: block.text, bold: true }],
          ctx.contentWidth,
          ctx.regularFont,
          ctx.boldFont,
          ctx.italicFont,
          ctx.codeFont,
          config.size
        );

        for (const line of headingLines) {
          const lineText = line.runs.map((r) => r.text).join('');
          ctx.currentPage.drawText(lineText, {
            x: ctx.margin,
            y: ctx.cursorY,
            size: config.size,
            font,
            color: block.level === 1 ? ctx.primaryColor : ctx.textColor,
          });
          ctx.cursorY -= config.size + 4;
        }

        // Draw an underline for H1 and H2
        if (block.level === 1 || block.level === 2) {
          ctx.cursorY += 2;
          ctx.currentPage.drawLine({
            start: { x: ctx.margin, y: ctx.cursorY },
            end: { x: ctx.margin + ctx.contentWidth, y: ctx.cursorY },
            thickness: block.level === 1 ? 1.2 : 0.6,
            color: ctx.borderColor,
          });
          ctx.cursorY -= 4;
        }

        ctx.cursorY -= config.spacingBottom;
        break;
      }

      case 'paragraph': {
        const fontSize = 10;
        const lineHeight = 14;
        const lines = wrapRuns(
          block.runs,
          ctx.contentWidth,
          ctx.regularFont,
          ctx.boldFont,
          ctx.italicFont,
          ctx.codeFont,
          fontSize
        );

        if (lines.length === 0) break;

        ensureSpace(ctx, lineHeight);

        for (const line of lines) {
          ensureSpace(ctx, lineHeight);
          let currentX = ctx.margin;

          for (const run of line.runs) {
            ctx.currentPage.drawText(run.text, {
              x: currentX,
              y: ctx.cursorY,
              size: fontSize,
              font: run.font,
              color: run.color || ctx.textColor,
            });
            currentX += run.font.widthOfTextAtSize(run.text, fontSize);
          }

          ctx.cursorY -= lineHeight;
        }

        ctx.cursorY -= 6; // paragraph spacing
        break;
      }

      case 'code_block': {
        const fontSize = 8.5;
        const lineHeight = 12;
        const padding = 8;
        const codeLines = block.code.split('\n');
        const boxHeight = codeLines.length * lineHeight + padding * 2;

        ensureSpace(ctx, Math.min(boxHeight, 100));

        // Draw background box
        const startY = ctx.cursorY;
        const effectiveHeight = Math.min(boxHeight, startY - ctx.bottomLimit + padding);

        ctx.currentPage.drawRectangle({
          x: ctx.margin,
          y: startY - effectiveHeight,
          width: ctx.contentWidth,
          height: effectiveHeight,
          color: ctx.bgCodeColor,
          borderColor: ctx.borderColor,
          borderWidth: 0.8,
        });

        ctx.cursorY -= padding + lineHeight - 3;

        for (const lineText of codeLines) {
          ensureSpace(ctx, lineHeight);
          const safeText = lineText.slice(0, 110); // cap line length to fit page width
          ctx.currentPage.drawText(safeText, {
            x: ctx.margin + padding,
            y: ctx.cursorY,
            size: fontSize,
            font: ctx.codeFont,
            color: ctx.textColor,
          });
          ctx.cursorY -= lineHeight;
        }

        ctx.cursorY -= padding + 4;
        break;
      }

      case 'blockquote': {
        const fontSize = 9.5;
        const lineHeight = 13.5;
        const barWidth = 3;
        const paddingLeft = 12;
        const innerWidth = ctx.contentWidth - paddingLeft - barWidth;

        const lines = wrapRuns(
          block.runs,
          innerWidth,
          ctx.regularFont,
          ctx.boldFont,
          ctx.italicFont,
          ctx.codeFont,
          fontSize
        );

        if (lines.length === 0) break;

        const blockHeight = lines.length * lineHeight + 4;
        ensureSpace(ctx, blockHeight);

        const startY = ctx.cursorY + 2;
        const endY = startY - blockHeight;

        ctx.currentPage.drawLine({
          start: { x: ctx.margin, y: startY },
          end: { x: ctx.margin, y: endY },
          thickness: barWidth,
          color: COLORS.blockquoteBar,
        });

        for (const line of lines) {
          ensureSpace(ctx, lineHeight);
          let currentX = ctx.margin + paddingLeft + barWidth;
          for (const run of line.runs) {
            ctx.currentPage.drawText(run.text, {
              x: currentX,
              y: ctx.cursorY,
              size: fontSize,
              font: run.font,
              color: ctx.mutedColor,
            });
            currentX += run.font.widthOfTextAtSize(run.text, fontSize);
          }
          ctx.cursorY -= lineHeight;
        }

        ctx.cursorY -= 6;
        break;
      }

      case 'list': {
        const fontSize = 10;
        const lineHeight = 14;
        const bulletIndent = 16;
        const itemWidth = ctx.contentWidth - bulletIndent;

        for (let idx = 0; idx < block.items.length; idx++) {
          const item = block.items[idx];
          const lines = wrapRuns(
            item.runs,
            itemWidth,
            ctx.regularFont,
            ctx.boldFont,
            ctx.italicFont,
            ctx.codeFont,
            fontSize
          );

          ensureSpace(ctx, lineHeight);

          const bulletLabel = block.ordered ? `${idx + 1}.` : '•';
          ctx.currentPage.drawText(bulletLabel, {
            x: ctx.margin + (block.ordered ? 0 : 4),
            y: ctx.cursorY,
            size: fontSize,
            font: ctx.boldFont,
            color: ctx.primaryColor,
          });

          for (let l = 0; l < lines.length; l++) {
            if (l > 0) ensureSpace(ctx, lineHeight);
            let currentX = ctx.margin + bulletIndent;
            for (const run of lines[l].runs) {
              ctx.currentPage.drawText(run.text, {
                x: currentX,
                y: ctx.cursorY,
                size: fontSize,
                font: run.font,
                color: run.color || ctx.textColor,
              });
              currentX += run.font.widthOfTextAtSize(run.text, fontSize);
            }
            ctx.cursorY -= lineHeight;
          }

          ctx.cursorY -= 2;
        }

        ctx.cursorY -= 4;
        break;
      }

      case 'task_list': {
        const fontSize = 10;
        const lineHeight = 14;
        const boxSize = 8;
        const indent = 16;
        const itemWidth = ctx.contentWidth - indent;

        for (const item of block.items) {
          const lines = wrapRuns(
            item.runs,
            itemWidth,
            ctx.regularFont,
            ctx.boldFont,
            ctx.italicFont,
            ctx.codeFont,
            fontSize
          );

          ensureSpace(ctx, lineHeight);

          // Draw checkbox box
          const boxY = ctx.cursorY + 1;
          ctx.currentPage.drawRectangle({
            x: ctx.margin + 2,
            y: boxY,
            width: boxSize,
            height: boxSize,
            borderColor: ctx.borderColor,
            borderWidth: 1,
            color: item.checked ? rgb(0.9, 0.95, 1) : rgb(1, 1, 1),
          });

          if (item.checked) {
            ctx.currentPage.drawText('x', {
              x: ctx.margin + 3.5,
              y: boxY + 1,
              size: 7,
              font: ctx.boldFont,
              color: ctx.primaryColor,
            });
          }

          for (let l = 0; l < lines.length; l++) {
            if (l > 0) ensureSpace(ctx, lineHeight);
            let currentX = ctx.margin + indent;
            for (const run of lines[l].runs) {
              ctx.currentPage.drawText(run.text, {
                x: currentX,
                y: ctx.cursorY,
                size: fontSize,
                font: run.font,
                color: run.color || ctx.textColor,
              });
              currentX += run.font.widthOfTextAtSize(run.text, fontSize);
            }
            ctx.cursorY -= lineHeight;
          }

          ctx.cursorY -= 2;
        }

        ctx.cursorY -= 4;
        break;
      }

      case 'table': {
        if (block.headers.length === 0) break;
        const numCols = block.headers.length;
        const colWidth = ctx.contentWidth / numCols;
        const cellPadding = 5;
        const rowHeight = 18;
        const fontSize = 9;

        const tableHeight = (block.rows.length + 1) * rowHeight;
        ensureSpace(ctx, Math.min(tableHeight, 80));

        // Draw header row background
        ctx.currentPage.drawRectangle({
          x: ctx.margin,
          y: ctx.cursorY - rowHeight,
          width: ctx.contentWidth,
          height: rowHeight,
          color: ctx.bgCodeColor,
          borderColor: ctx.borderColor,
          borderWidth: 0.8,
        });

        // Draw header labels
        for (let c = 0; c < numCols; c++) {
          const text = block.headers[c] || '';
          ctx.currentPage.drawText(text.slice(0, 25), {
            x: ctx.margin + c * colWidth + cellPadding,
            y: ctx.cursorY - rowHeight + cellPadding,
            size: fontSize,
            font: ctx.boldFont,
            color: ctx.textColor,
          });
        }

        ctx.cursorY -= rowHeight;

        // Draw rows
        for (const row of block.rows) {
          ensureSpace(ctx, rowHeight);

          ctx.currentPage.drawLine({
            start: { x: ctx.margin, y: ctx.cursorY },
            end: { x: ctx.margin + ctx.contentWidth, y: ctx.cursorY },
            thickness: 0.5,
            color: ctx.borderColor,
          });

          for (let c = 0; c < numCols; c++) {
            const text = row[c] || '';
            ctx.currentPage.drawText(text.slice(0, 25), {
              x: ctx.margin + c * colWidth + cellPadding,
              y: ctx.cursorY - rowHeight + cellPadding,
              size: fontSize,
              font: ctx.regularFont,
              color: ctx.textColor,
            });
          }

          ctx.cursorY -= rowHeight;
        }

        ctx.cursorY -= 8;
        break;
      }

      case 'horizontal_rule': {
        ensureSpace(ctx, 16);
        ctx.cursorY -= 8;
        ctx.currentPage.drawLine({
          start: { x: ctx.margin, y: ctx.cursorY },
          end: { x: ctx.margin + ctx.contentWidth, y: ctx.cursorY },
          thickness: 0.8,
          color: ctx.borderColor,
        });
        ctx.cursorY -= 8;
        break;
      }
    }
  }
}

/**
 * Converts one or more markdown document texts into a professional PDF.
 */
export async function renderMarkdownToPdf(
  markdownDocuments: { name?: string; content: string }[],
  options: MarkdownPdfOptions = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  // Page dimensions
  const pageSize = options.pageSize === 'Letter' ? PageSizes.Letter : PageSizes.A4;
  const [pageWidth, pageHeight] = pageSize;
  const margin = options.marginPt ?? 54; // 0.75 in
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = margin;

  // Typography Theme
  const isSerif = options.theme === 'serif';
  const regularFont = await doc.embedFont(isSerif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(isSerif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(isSerif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique);
  const codeFont = await doc.embedFont(StandardFonts.Courier);

  const pages: PDFPage[] = [];
  const initialPage = doc.addPage([pageWidth, pageHeight]);
  pages.push(initialPage);

  const ctx: RenderContext = {
    doc,
    pages,
    currentPage: initialPage,
    pageWidth,
    pageHeight,
    margin,
    contentWidth,
    cursorY: pageHeight - margin,
    bottomLimit,
    regularFont,
    boldFont,
    italicFont,
    codeFont,
    primaryColor: COLORS.primary,
    textColor: COLORS.text,
    mutedColor: COLORS.muted,
    borderColor: COLORS.border,
    bgCodeColor: COLORS.bgCode,
  };

  for (let docIdx = 0; docIdx < markdownDocuments.length; docIdx++) {
    const markdownDoc = markdownDocuments[docIdx];
    if (docIdx > 0 && options.pageBreakPerFile) {
      addNewPage(ctx);
    }

    const blocks = parseMarkdown(markdownDoc.content);
    renderBlocks(ctx, blocks);
  }

  // Second pass: Draw page numbers and optional header title
  const totalPages = doc.getPageCount();
  const showNumbers = options.showPageNumbers ?? true;

  if (showNumbers || options.documentTitle) {
    for (let p = 0; p < totalPages; p++) {
      const page = doc.getPage(p);

      if (options.documentTitle) {
        const headerText = options.documentTitle.slice(0, 40);
        page.drawText(headerText, {
          x: margin,
          y: pageHeight - margin / 1.6,
          size: 8,
          font: regularFont,
          color: COLORS.muted,
        });
      }

      if (showNumbers) {
        const pageLabel = `${p + 1} / ${totalPages}`;
        const labelWidth = regularFont.widthOfTextAtSize(pageLabel, 8);
        page.drawText(pageLabel, {
          x: pageWidth - margin - labelWidth,
          y: margin / 1.8,
          size: 8,
          font: regularFont,
          color: COLORS.muted,
        });
      }
    }
  }

  return (await doc.save()).slice();
}
