import { PDFDocument, PDFHexString, PDFPage } from 'pdf-lib';
import type { Mark, Rgb } from '@/lib/studio/script';

export type ReviewMark = Extract<
  Mark,
  { kind: 'highlight' | 'underline' | 'strikeout' | 'comment' }
>;

const number = (value: number) => Number(value.toFixed(4));
const colorArray = (color: Rgb) => [number(color.r), number(color.g), number(color.b)];

function pdfDate(iso: string): string {
  const parsed = new Date(iso);
  const date = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  const part = (value: number) => String(value).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${part(date.getUTCMonth() + 1)}${part(date.getUTCDate())}${part(date.getUTCHours())}${part(date.getUTCMinutes())}${part(date.getUTCSeconds())}Z`;
}

function threadText(mark: ReviewMark): string {
  const replies = mark.replies.map((reply) => `${reply.author}: ${reply.body}`);
  return [mark.body, ...replies].filter((entry) => entry.trim() !== '').join('\n\n');
}

function appearance(
  document: PDFDocument,
  width: number,
  height: number,
  contents: string,
  opacity: number
) {
  const context = document.context;
  const stream = context.flateStream(contents, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, number(width), number(height)],
    Matrix: [1, 0, 0, 1, 0, 0],
    Resources: {
      ExtGState: {
        GS0: {
          Type: 'ExtGState',
          ca: number(opacity),
          CA: number(opacity),
          BM: 'Multiply',
        },
      },
    },
  });
  return context.register(stream);
}

function markupAppearance(document: PDFDocument, mark: Exclude<ReviewMark, { kind: 'comment' }>) {
  const [r, g, b] = colorArray(mark.color);
  const width = Math.max(mark.width, 1);
  const height = Math.max(mark.height, 1);
  const lineWidth = Math.max(1, Math.min(3, height / 7));
  let drawing: string;

  if (mark.kind === 'highlight') {
    drawing = `q /GS0 gs ${r} ${g} ${b} rg 0 0 ${number(width)} ${number(height)} re f Q`;
  } else {
    const y = mark.kind === 'underline' ? lineWidth / 2 : height / 2;
    drawing = `q /GS0 gs ${r} ${g} ${b} RG ${number(lineWidth)} w 0 ${number(y)} m ${number(width)} ${number(y)} l S Q`;
  }

  return appearance(document, width, height, drawing, mark.opacity);
}

function commentAppearance(document: PDFDocument, color: Rgb) {
  const [r, g, b] = colorArray(color);
  const drawing = [
    'q /GS0 gs',
    `${r} ${g} ${b} rg 0.5 0.5 19 19 re f`,
    '0.18 0.18 0.18 RG 1 w 0.5 0.5 19 19 re S',
    '12 19.5 m 12 12 l 19.5 12 l S',
    'Q',
  ].join(' ');
  return appearance(document, 20, 20, drawing, 1);
}

/** Adds one standards-based PDF review annotation with a deterministic appearance. */
export function addReviewAnnotation(
  document: PDFDocument,
  page: PDFPage,
  mark: ReviewMark
): void {
  const context = document.context;
  const isComment = mark.kind === 'comment';
  const width = isComment ? 20 : Math.max(mark.width, 1);
  const height = isComment ? 20 : Math.max(mark.height, 1);
  const x = mark.x;
  const y = mark.y;
  const subtype =
    mark.kind === 'highlight'
      ? 'Highlight'
      : mark.kind === 'underline'
        ? 'Underline'
        : mark.kind === 'strikeout'
          ? 'StrikeOut'
          : 'Text';
  const appearanceRef = isComment
    ? commentAppearance(document, mark.color)
    : markupAppearance(document, mark);

  const annotation = context.obj({
    Type: 'Annot',
    Subtype: subtype,
    Rect: [number(x), number(y), number(x + width), number(y + height)],
    C: colorArray(mark.color),
    F: 4,
    NM: PDFHexString.fromText(mark.id),
    T: PDFHexString.fromText(mark.author),
    Contents: PDFHexString.fromText(threadText(mark)),
    CreationDate: PDFHexString.fromText(pdfDate(mark.createdAt)),
    M: PDFHexString.fromText(pdfDate(mark.createdAt)),
    P: page.ref,
    AP: { N: appearanceRef },
    ...(isComment
      ? { Name: 'Comment', Open: false }
      : {
          QuadPoints: [
            number(x),
            number(y + height),
            number(x + width),
            number(y + height),
            number(x),
            number(y),
            number(x + width),
            number(y),
          ],
          CA: number(mark.opacity),
        }),
  });

  page.node.addAnnot(context.register(annotation));
}
