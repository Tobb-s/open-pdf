import { describe, expect, it } from 'vitest';
import { comparePageText, textSimilarity } from '@/lib/studio/compare';

describe('PDF page comparison', () => {
  it('recognises unchanged, moved, modified, added and removed pages', () => {
    const report = comparePageText(
      [
        { page: 1, text: 'Portada del contrato' },
        { page: 2, text: 'Cláusula uno vigente' },
        { page: 3, text: 'Documento histórico retirado' },
        { page: 4, text: 'Firmas de las partes' },
      ],
      [
        { page: 1, text: 'Portada del contrato' },
        { page: 2, text: 'Firmas de las partes' },
        { page: 3, text: 'Cláusula uno actualizada' },
        { page: 4, text: 'Anexo completamente nuevo' },
      ],
      '2026-08-25T00:00:00.000Z'
    );

    expect(report.summary).toEqual({ unchanged: 1, modified: 1, moved: 1, added: 1, removed: 1 });
    expect(report.differences.find((item) => item.status === 'moved')).toMatchObject({
      basePage: 4,
      comparisonPage: 2,
    });
    const modified = report.differences.find((item) => item.status === 'modified');
    expect(modified).toMatchObject({ basePage: 2, comparisonPage: 3, addedWords: 1, removedWords: 1 });
  });

  it('uses repeated-word counts instead of overstating set overlap', () => {
    expect(textSimilarity('uno uno uno dos', 'uno dos tres cuatro')).toBe(0.5);
  });

  it('treats whitespace and casing changes as unchanged', () => {
    const report = comparePageText(
      [{ page: 1, text: 'Texto   ORIGINAL' }],
      [{ page: 1, text: 'texto original' }]
    );
    expect(report.summary.unchanged).toBe(1);
  });

  it('marks equal text as modified when the page image changed', () => {
    const report = comparePageText(
      [{ page: 1, text: 'Mismo texto', visualHash: '0'.repeat(64) }],
      [{ page: 1, text: 'Mismo texto', visualHash: '1'.repeat(64) }]
    );
    expect(report.summary.modified).toBe(1);
  });

  it('compares scan-only pages through their visual hashes', () => {
    const report = comparePageText(
      [{ page: 1, text: '', visualHash: '0'.repeat(64) }],
      [{ page: 1, text: '', visualHash: `${'0'.repeat(32)}${'1'.repeat(32)}` }]
    );
    expect(report.summary.modified).toBe(1);
  });
});
