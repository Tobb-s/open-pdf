import { describe, expect, it } from 'vitest';
import { extractDocumentElements, type TextFragment } from '@/lib/textLayout';

function makeFragment(overrides: Partial<TextFragment>): TextFragment {
  return {
    str: 'texto',
    x: 40,
    y: 700,
    width: 50,
    height: 10,
    hasEOL: false,
    ...overrides,
  };
}

describe('extractDocumentElements', () => {
  it('detects headings when font size is significantly larger than body text', () => {
    const fragments: TextFragment[] = [
      // Heading (large font 18pt)
      makeFragment({ str: 'Capítulo 1: Introducción', x: 40, y: 750, width: 200, height: 18, hasEOL: true }),
      // Body paragraph (normal font 10pt)
      makeFragment({ str: 'Este es el primer párrafo del capítulo.', x: 40, y: 710, width: 250, height: 10, hasEOL: true }),
      makeFragment({ str: 'Sigue explicando el tema principal con detalle.', x: 40, y: 695, width: 260, height: 10, hasEOL: true }),
    ];

    const elements = extractDocumentElements(fragments);
    expect(elements).toHaveLength(2);
    expect(elements[0].type).toBe('heading');
    if (elements[0].type === 'heading') {
      expect(elements[0].text).toBe('Capítulo 1: Introducción');
      expect(elements[0].level).toBe(1);
    }
    expect(elements[1].type).toBe('paragraph');
  });

  it('detects tables when multiple rows have aligned columns', () => {
    const fragments: TextFragment[] = [
      // Table Header row (Y=700)
      makeFragment({ str: 'Producto', x: 40, y: 700, width: 60, height: 10 }),
      makeFragment({ str: 'Precio', x: 200, y: 700, width: 40, height: 10 }),
      makeFragment({ str: 'Stock', x: 350, y: 700, width: 35, height: 10, hasEOL: true }),

      // Table Row 1 (Y=685)
      makeFragment({ str: 'Cuaderno', x: 40, y: 685, width: 60, height: 10 }),
      makeFragment({ str: '$150', x: 200, y: 685, width: 30, height: 10 }),
      makeFragment({ str: '45', x: 350, y: 685, width: 15, height: 10, hasEOL: true }),

      // Table Row 2 (Y=670)
      makeFragment({ str: 'Lapicera', x: 40, y: 670, width: 55, height: 10 }),
      makeFragment({ str: '$80', x: 200, y: 670, width: 25, height: 10 }),
      makeFragment({ str: '120', x: 350, y: 670, width: 20, height: 10, hasEOL: true }),
    ];

    const elements = extractDocumentElements(fragments);
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('table');
    if (elements[0].type === 'table') {
      expect(elements[0].rows).toHaveLength(3);
      expect(elements[0].rows[0]).toEqual(['Producto', 'Precio', 'Stock']);
      expect(elements[0].rows[1]).toEqual(['Cuaderno', '$150', '45']);
      expect(elements[0].rows[2]).toEqual(['Lapicera', '$80', '120']);
    }
  });

  it('preserves bold and italic styles across runs', () => {
    const fragments: TextFragment[] = [
      makeFragment({ str: 'Texto normal ', x: 40, y: 700, width: 60, height: 10 }),
      makeFragment({ str: 'con negrita', x: 105, y: 700, width: 50, height: 10, isBold: true }),
      makeFragment({ str: ' y cursiva.', x: 160, y: 700, width: 50, height: 10, isItalic: true, hasEOL: true }),
    ];

    const elements = extractDocumentElements(fragments);
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('paragraph');
    if (elements[0].type === 'paragraph') {
      expect(elements[0].runs.some((r) => r.bold)).toBe(true);
      expect(elements[0].runs.some((r) => r.italic)).toBe(true);
    }
  });
});
