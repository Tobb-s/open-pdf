import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import { materialize } from '@/lib/studio/materialize';
import { buildSignatureAudit, signatureAuditBytes } from '@/lib/studio/signatureAudit';
import { stateAt, type Edit, type Mark } from '@/lib/studio/script';
import { summarizeStructures } from '@/lib/verify/structural';

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (character) => character.charCodeAt(0)
);

const signature: Extract<Mark, { kind: 'signature' }> = {
  kind: 'signature',
  id: 'signature-1',
  page: 'o0',
  asset: 'appearance',
  x: 60,
  y: 80,
  width: 180,
  height: 48,
  signer: 'Tobias Example',
  reason: 'Aprobación del documento',
  signedAt: '2026-08-25T20:15:30.000Z',
  signedOn: '2026-08-25',
  method: 'drawn',
};

describe('electronic signature audit record', () => {
  it('binds the visible appearance to signer, page, method, time, and SHA-256', async () => {
    const record = await buildSignatureAudit(signature, PNG, 3);
    expect(record).toMatchObject({
      signatureId: 'signature-1',
      signer: 'Tobias Example',
      reason: 'Aprobación del documento',
      signedAt: '2026-08-25T20:15:30.000Z',
      signedOn: '2026-08-25',
      method: 'drawn',
      page: 3,
      identityVerified: false,
      certificateBased: false,
    });
    expect(record.appearanceSha256).toBe(createHash('sha256').update(PNG).digest('hex'));

    const decoded = JSON.parse(new TextDecoder().decode(signatureAuditBytes(record)));
    expect(decoded.appearanceSha256).toBe(record.appearanceSha256);
  });
});

describe('Studio electronic signatures', () => {
  it('draws the signature and caption, and embeds one inspectable audit attachment', async () => {
    const source = await PDFDocument.create();
    source.addPage([400, 300]);
    const original = (await source.save()).slice();
    const edit: Edit = { kind: 'draw', mark: signature };

    const { bytes } = await materialize({
      original,
      assets: new Map([['appearance', PNG]]),
      state: stateAt(1, [edit], 1),
    });

    const output = await PDFDocument.load(bytes);
    const summary = summarizeStructures(output);
    expect(summary.categories.attachments).toBe(1);
    // A visible electronic signature must never masquerade as a certificate field.
    expect(summary.categories.signatures).toBe(0);

    const images = output.context.enumerateIndirectObjects().filter(
      ([, object]) =>
        object instanceof PDFStream &&
        object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
    );
    expect(images.length).toBeGreaterThan(0);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes.slice() });
    const opened = await task.promise;
    const content = await (await opened.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    await task.destroy();
    expect(text).toContain('Tobias Example');
    expect(text).toContain('2026-08-25');
  });

  it('is removed completely by one undo', () => {
    const edit: Edit = { kind: 'draw', mark: signature };
    expect(stateAt(1, [edit], 1).marks).toEqual([signature]);
    expect(stateAt(1, [edit], 0).marks).toEqual([]);
  });
});
