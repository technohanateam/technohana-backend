import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const keyLength = 32;
const ivLength = 16;
const saltLength = 16;
const tagLength = 16;

const ENROLLMENT_TOKEN_KEY = process.env.ENROLLMENT_TOKEN_KEY;
if (!ENROLLMENT_TOKEN_KEY) {
  throw new Error('ENROLLMENT_TOKEN_KEY environment variable is required for token encryption');
}

const deriveKey = (salt) => {
  return crypto.pbkdf2Sync(ENROLLMENT_TOKEN_KEY, salt, 100000, keyLength, 'sha256');
};

export const encryptToken = (data) => {
  try {
    const salt = crypto.randomBytes(saltLength);
    const key = deriveKey(salt);
    const iv = crypto.randomBytes(ivLength);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([salt, iv, encrypted, tag]).toString('base64');
  } catch (error) {
    console.error('Token encryption error:', error);
    throw new Error('Failed to encrypt token');
  }
};

export const decryptToken = (encryptedToken) => {
  try {
    const buffer = Buffer.from(encryptedToken, 'base64');

    const salt = buffer.subarray(0, saltLength);
    const iv = buffer.subarray(saltLength, saltLength + ivLength);
    const tag = buffer.subarray(buffer.length - tagLength);
    const encrypted = buffer.subarray(saltLength + ivLength, buffer.length - tagLength);

    const key = deriveKey(salt);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  } catch (error) {
    console.error('Token decryption error:', error);
    throw new Error('Failed to decrypt token');
  }
};
