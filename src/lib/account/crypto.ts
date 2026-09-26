import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key() {
  const value = process.env.ACCOUNT_VAULT_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('account_unavailable');
  return Buffer.from(value, 'hex');
}
export function sealCredential(secret: string, binding: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(binding));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
export function openCredential(envelope: string, binding: string): string {
  const [version, iv, tag, data, extra] = envelope.split('.');
  if (version !== 'v1' || !iv || !tag || !data || extra !== undefined) throw new Error('account_unavailable');
  const nonce = Buffer.from(iv, 'base64url'), authTag = Buffer.from(tag, 'base64url');
  if (nonce.length !== 12 || authTag.length !== 16) throw new Error('account_unavailable');
  const decipher = createDecipheriv('aes-256-gcm', key(), nonce);
  decipher.setAAD(Buffer.from(binding)); decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
