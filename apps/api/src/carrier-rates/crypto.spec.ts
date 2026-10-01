import { decryptSecret, encryptSecret } from './crypto';

describe('carrier secrets crypto', () => {
  const OLD_ENV = process.env.CARRIER_CREDENTIALS_KEY;

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.CARRIER_CREDENTIALS_KEY;
    else process.env.CARRIER_CREDENTIALS_KEY = OLD_ENV;
  });

  it('round-trips a secret', () => {
    process.env.CARRIER_CREDENTIALS_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const enc = encryptSecret('super-secret-value');
    expect(enc).not.toContain('super-secret-value');
    expect(decryptSecret(enc)).toBe('super-secret-value');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    process.env.CARRIER_CREDENTIALS_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('throws a helpful error when the key is missing', () => {
    delete process.env.CARRIER_CREDENTIALS_KEY;
    expect(() => encryptSecret('x')).toThrow(/CARRIER_CREDENTIALS_KEY/);
  });

  it('rejects a malformed key', () => {
    process.env.CARRIER_CREDENTIALS_KEY = 'too-short';
    expect(() => encryptSecret('x')).toThrow(/64 hex/);
  });
});
