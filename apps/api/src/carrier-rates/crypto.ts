/**
 * AES-256-GCM encryption for carrier API secrets stored in the database.
 *
 * The key comes from the `CARRIER_CREDENTIALS_KEY` environment variable
 * (64 hex chars = 32 bytes). It is only required when credentials are
 * actually saved or read — the app boots fine without it until then.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function loadKey(): Buffer {
  const hex = (process.env.CARRIER_CREDENTIALS_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'CARRIER_CREDENTIALS_KEY must be set to 64 hex characters (32 bytes) ' +
        'before carrier API credentials can be saved or used. Generate one with: ' +
        'openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string): string {
  const key = loadKey();
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Stored carrier credential is not in the expected format.');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
