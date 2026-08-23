import { createHash } from 'node:crypto';

/**
 * Builds a PDF that is locked with an OWNER password only — the common shape
 * of a contract someone marked "no editing" — using the standard security
 * handler, revision 2, RC4 40-bit, with the user password left empty.
 *
 * It exists because nothing in the toolchain can make one: pdf-lib cannot
 * encrypt at all. And it is the exact case that mattered — pdf.js opens this
 * file without asking anything, because an empty user password is enough to
 * read it, while pdf-lib refuses it on sight. That gap is what let such a file
 * through Studio's door and into a session that then could not build.
 *
 * Algorithms 3.2–3.4 of the PDF 1.7 specification, written out rather than
 * borrowed: it is thirty lines, and owning them is what makes the fixture
 * trustworthy.
 */

const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function md5(...parts: Buffer[]): Buffer {
  const hash = createHash('md5');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

function padPassword(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);
}

export interface OwnerLockedOptions {
  ownerPassword?: string;
  /** The text drawn on the single page, to prove a reader decrypted it. */
  text?: string;
}

export function buildOwnerLockedPdf(options: OwnerLockedOptions = {}): Uint8Array {
  const owner = options.ownerPassword ?? 'propietario';
  const text = options.text ?? 'TEXTO VISIBLE';
  // No printing, no changes, no copying: the permissions of a locked contract.
  const permissions = -3904;
  const id = md5(Buffer.from('openpdf-encrypted-fixture', 'latin1'));

  // 3.3: the owner entry — the padded (empty) user password, under a key from
  // the owner password.
  const ownerKey = md5(padPassword(owner)).subarray(0, 5);
  const O = rc4(ownerKey, padPassword(''));

  // 3.2: the file key, from the padded user password, O, P and the first ID.
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const key = md5(padPassword(''), O, p, id).subarray(0, 5);

  // 3.4: the user entry, revision 2.
  const U = rc4(key, PAD);

  // Per-object keys, as every reader derives them.
  const objectKey = (number: number, generation: number) =>
    md5(
      key,
      Buffer.from([
        number & 255,
        (number >> 8) & 255,
        (number >> 16) & 255,
        generation & 255,
        (generation >> 8) & 255,
      ])
    ).subarray(0, 10);

  const hex = (bytes: Buffer) => `<${bytes.toString('hex').toUpperCase()}>`;

  // The one content stream is object 4, so it is encrypted under key(4, 0).
  const content = Buffer.from(`BT /F1 18 Tf 40 200 Td (${text}) Tj ET`, 'latin1');
  const encrypted = rc4(objectKey(4, 0), content);

  const objects: Array<string | Buffer> = [];
  objects[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objects[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
  objects[3] =
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 300]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>';
  objects[4] = Buffer.concat([
    Buffer.from(`<</Length ${encrypted.length}>>\nstream\n`, 'latin1'),
    encrypted,
    Buffer.from('\nendstream', 'latin1'),
  ]);
  objects[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  objects[6] = `<</Filter/Standard/V 1/R 2/Length 40/P ${permissions}/O ${hex(O)}/U ${hex(U)}>>`;

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let offset = parts[0].length;
  const offsets: number[] = [];
  for (let number = 1; number <= 6; number += 1) {
    offsets[number] = offset;
    const body = objects[number];
    const chunk = Buffer.concat([
      Buffer.from(`${number} 0 obj\n`, 'latin1'),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    offset += chunk.length;
  }

  const xref = offset;
  let tail = 'xref\n0 7\n0000000000 65535 f \n';
  for (let number = 1; number <= 6; number += 1) {
    tail += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  tail +=
    `trailer\n<</Size 7/Root 1 0 R/Encrypt 6 0 R/ID[${hex(id)}${hex(id)}]>>\n` +
    `startxref\n${xref}\n%%EOF\n`;
  parts.push(Buffer.from(tail, 'latin1'));

  return new Uint8Array(Buffer.concat(parts));
}
