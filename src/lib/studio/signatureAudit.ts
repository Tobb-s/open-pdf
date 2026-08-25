import type { Mark } from '@/lib/studio/script';
import { sha256Hex } from '@/lib/hash';

export type SignatureMark = Extract<Mark, { kind: 'signature' }>;

export interface SignatureAuditRecord {
  schema: 'openpdf-electronic-signature-audit/v1';
  signatureId: string;
  signer: string;
  reason: string;
  signedAt: string;
  signedOn: string;
  method: SignatureMark['method'];
  page: number;
  appearanceSha256: string;
  identityVerified: false;
  certificateBased: false;
  notice: string;
}

export async function buildSignatureAudit(
  mark: SignatureMark,
  appearance: Uint8Array,
  page: number
): Promise<SignatureAuditRecord> {
  return {
    schema: 'openpdf-electronic-signature-audit/v1',
    signatureId: mark.id,
    signer: mark.signer,
    reason: mark.reason,
    signedAt: mark.signedAt,
    signedOn: mark.signedOn,
    method: mark.method,
    page,
    appearanceSha256: await sha256Hex(appearance),
    identityVerified: false,
    certificateBased: false,
    notice:
      'Electronic signature appearance created locally. This is not a certificate-based digital signature.',
  };
}

export function signatureAuditBytes(record: SignatureAuditRecord): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`);
}
