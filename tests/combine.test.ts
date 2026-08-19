import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { combinePdfs } from '@/lib/combine';
import { uniqueNames } from '@/lib/office';

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return (await doc.save()).slice();
}

describe('combinePdfs', () => {
  it('appends the parts in the order given', async () => {
    const result = await combinePdfs([
      { bytes: await makePdf(2), label: 'a' },
      { bytes: await makePdf(3), label: 'b' },
      { bytes: await makePdf(1), label: 'c' },
    ]);

    expect(result.pages).toBe(6);
    expect(result.skipped).toEqual([]);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(6);
  });

  it('keeps the rest when one part is unreadable', async () => {
    // Losing one lecture out of three is bad; losing all three because of it
    // would be worse.
    const result = await combinePdfs([
      { bytes: await makePdf(2), label: 'buena.pptx' },
      { bytes: new Uint8Array([1, 2, 3, 4]), label: 'rota.pptx' },
      { bytes: await makePdf(4), label: 'otra.pptx' },
    ]);

    expect(result.pages).toBe(6);
    expect(result.skipped).toEqual(['rota.pptx']);
  });

  it('refuses to hand back an empty document', async () => {
    await expect(
      combinePdfs([{ bytes: new Uint8Array([0, 0]), label: 'rota.pptx' }])
    ).rejects.toThrow();
  });

  it('handles a single part without changing it', async () => {
    const result = await combinePdfs([{ bytes: await makePdf(5), label: 'sola' }]);
    expect(result.pages).toBe(5);
  });
});

describe('uniqueNames', () => {
  it('leaves distinct names alone', () => {
    expect(uniqueNames(['a.pptx', 'b.docx'])).toEqual(['a.pdf', 'b.pdf']);
  });

  it('numbers repeats instead of overwriting them', () => {
    // Two folders each holding "Clase 1.pptx" is ordinary; a zip that kept one
    // of them would quietly lose the other.
    expect(uniqueNames(['Clase 1.pptx', 'Clase 1.pptx', 'Clase 1.ppsx'])).toEqual([
      'Clase 1.pdf',
      'Clase 1 (2).pdf',
      'Clase 1 (3).pdf',
    ]);
  });

  it('treats names differing only in case as the same', () => {
    expect(uniqueNames(['Tema.pptx', 'TEMA.pptx'])).toEqual(['Tema.pdf', 'TEMA (2).pdf']);
  });

  it('returns one name per input, always', () => {
    const input = Array.from({ length: 12 }, () => 'x.pptx');
    const names = uniqueNames(input);
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
  });
});

describe('uniqueNames avoids the collisions it invents', () => {
  it('does not reuse a suffix another file already owns', () => {
    // The bug: counting repeats of the base name alone invents " (2)" without
    // checking whether some other file is already called that. JSZip overwrites
    // silently, so a converted PDF vanished while the count still claimed it.
    expect(uniqueNames(['Clase 1.pptx', 'Clase 1.docx', 'Clase 1 (2).pptx'])).toEqual([
      'Clase 1.pdf',
      'Clase 1 (2).pdf',
      // Its own base already ends in " (2)", so it steps past that rather than
      // taking the name the previous file just claimed.
      'Clase 1 (2) (2).pdf',
    ]);
  });

  it('skips past a name claimed later in the list too', () => {
    expect(uniqueNames(['Tema.pptx', 'Tema.pptx', 'Tema.pptx', 'Tema (2).pptx'])).toEqual([
      'Tema.pdf',
      'Tema (2).pdf',
      'Tema (3).pdf',
      'Tema (2) (2).pdf',
    ]);
  });

  it('never returns two equal names, whatever the order', () => {
    const awkward = ['a.pptx', 'a (2).pptx', 'a.docx', 'a (3).odp', 'a.rtf', 'a (2).xlsx'];
    for (const list of [awkward, [...awkward].reverse()]) {
      const names = uniqueNames(list);
      expect(names).toHaveLength(list.length);
      expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(list.length);
    }
  });
});
