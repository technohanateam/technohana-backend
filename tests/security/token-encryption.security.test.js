import { encryptToken, decryptToken } from '../../src/utils/tokenCrypto.js';

describe('Security: Token Encryption', () => {
  test('Enrollment tokens should be encrypted, not Base64 encoded', () => {
    const tokenData = {
      orderId: 'ORD123456',
      email: 'user@example.com',
      paidAt: new Date().toISOString(),
    };

    const encryptedToken = encryptToken(tokenData);

    expect(encryptedToken).toBeDefined();
    expect(typeof encryptedToken).toBe('string');

    const decrypted = decryptToken(encryptedToken);
    expect(decrypted).toEqual(tokenData);
  });

  test('Base64 cannot decode encrypted tokens', () => {
    const tokenData = {
      orderId: 'ORD123456',
      email: 'user@example.com',
      timestamp: Date.now(),
    };

    const encryptedToken = encryptToken(tokenData);

    expect(() => {
      const decoded = Buffer.from(encryptedToken, 'base64').toString('utf8');
      JSON.parse(decoded);
    }).toThrow();
  });

  test('Each token should be unique due to salt and IV', () => {
    const tokenData = {
      orderId: 'ORD123456',
      email: 'user@example.com',
      paidAt: '2024-01-01',
    };

    const token1 = encryptToken(tokenData);
    const token2 = encryptToken(tokenData);

    expect(token1).not.toBe(token2);
    expect(decryptToken(token1)).toEqual(tokenData);
    expect(decryptToken(token2)).toEqual(tokenData);
  });

  test('Tampered tokens should fail to decrypt', () => {
    const tokenData = {
      orderId: 'ORD123456',
      email: 'user@example.com',
      paidAt: '2024-01-01',
    };

    const encryptedToken = encryptToken(tokenData);
    const tamperedToken = encryptedToken.slice(0, -5) + 'xxxxx';

    expect(() => {
      decryptToken(tamperedToken);
    }).toThrow();
  });

  test('Invalid tokens should fail to decrypt', () => {
    expect(() => {
      decryptToken('invalid-base64-token');
    }).toThrow();

    expect(() => {
      decryptToken('');
    }).toThrow();
  });
});
