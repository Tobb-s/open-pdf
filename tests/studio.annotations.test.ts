import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { stateAt, type Edit, type Mark } from '@/lib/studio/script';

const createdAt = '2026-08-25T12:34:56.000Z';
const color = { r: 0.95, g: 0.72, b: 0.12 };

const thread = {
  author: 'Tobias',
  body: '',
  createdAt,
  replies: [] as const,
};

async function fixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([400, 500]);
  return (await document.save()).slice();
}

function reviewMarks(): Mark[] {
  return [
    {
      kind: 'highlight',
      id: 'highlight-1',
      page: 'o0',
      x: 20,
      y: 400,
      width: 180,
      height: 18,
      color,
      opacity: 0.38,
      ...thread,
    },
    {
      kind: 'underline',
      id: 'underline-1',
      page: 'o0',
      x: 20,
      y: 360,
      width: 160,
      height: 18,
      color,
      opacity: 1,
      ...thread,
    },
    {
      kind: 'strikeout',
      id: 'strikeout-1',
      page: 'o0',
      x: 20,
      y: 320,
      width: 140,
      height: 18,
      color,
      opacity: 1,
      ...thread,
    },
    {
      kind: 'comment',
      id: 'comment-1',
      page: 'o0',
      x: 240,
      y: 400,
      color,
      author: 'Tobias',
      body: 'Revisar este párrafo.',
      createdAt,
      replies: [
        {
          id: 'reply-1',
          author: 'Equipo',
          body: 'Corregido.',
          createdAt: '2026-08-25T12:40:00.000Z',
        },
      ],
    },
  ];
}

describe('Studio review annotations', () => {
  it('exports standard PDF annotations with appearances and threaded text', async () => {
    const original = await fixture();
    const marks = reviewMarks();
    const edits: Edit[] = marks.map((mark) => ({ kind: 'draw', mark }));
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(1, edits, edits.length),
    });

    const output = await PDFDocument.load(bytes);
    const annots = output.getPage(0).node.Annots();
    expect(annots?.size()).toBe(4);

    const dictionaries = Array.from({ length: annots?.size() ?? 0 }, (_, index) =>
      output.context.lookup(annots!.get(index), PDFDict)
    );
    expect(dictionaries.map((dict) => dict.get(PDFName.of('Subtype'))?.toString())).toEqual([
      '/Highlight',
      '/Underline',
      '/StrikeOut',
      '/Text',
    ]);

    for (const annotation of dictionaries) {
      const appearances = annotation.lookup(PDFName.of('AP'), PDFDict);
      const normal = appearances.get(PDFName.of('N'));
      const stream = normal instanceof PDFRef ? output.context.lookup(normal) : normal;
      expect(stream).toBeInstanceOf(PDFRawStream);
    }

    const contents = dictionaries[3]
      .lookup(PDFName.of('Contents'), PDFHexString)
      .decodeText();
    expect(contents).toContain('Revisar este párrafo.');
    expect(contents).toContain('Equipo: Corregido.');
  });

  it('is recognised by pdf.js as native review annotations', async () => {
    const original = await fixture();
    const marks = reviewMarks();
    const { bytes } = await materialize({
      original,
      assets: new Map(),
      state: stateAt(
        1,
        marks.map((mark) => ({ kind: 'draw', mark })),
        marks.length
      ),
    });

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const opened = await task.promise;
    try {
      const page = await opened.getPage(1);
      const annotations = await page.getAnnotations({ intent: 'display' });
      expect(annotations.map((entry) => entry.annotationType)).toEqual([9, 10, 12, 1]);
      page.cleanup();
    } finally {
      await task.destroy();
    }
  });

  it('replaces a comment without losing its place in undo and redo', () => {
    const comment = reviewMarks()[3] as Extract<Mark, { kind: 'comment' }>;
    const replacement: Mark = {
      ...comment,
      replies: [
        ...comment.replies,
        { id: 'reply-2', author: 'Ana', body: 'Listo.', createdAt },
      ],
    };
    const edits: Edit[] = [
      { kind: 'draw', mark: comment },
      { kind: 'replaceMark', mark: replacement },
    ];

    expect((stateAt(1, edits, 1).marks[0] as typeof comment).replies).toHaveLength(1);
    expect((stateAt(1, edits, 2).marks[0] as typeof comment).replies).toHaveLength(2);
    expect((stateAt(1, edits, 1).marks[0] as typeof comment).replies).toHaveLength(1);
  });
});
