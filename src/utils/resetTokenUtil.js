import crypto from 'crypto';

const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || 'reset-token-secret';

export const generateResetToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  return { token, hash };
};

export const hashToken = (token) => {
  return crypto
    .createHash('sha256')
    .update(token + RESET_TOKEN_SECRET)
    .digest('hex');
};

export const verifyResetToken = (providedToken, storedHash) => {
  const hash = hashToken(providedToken);
  return hash === storedHash;
};

export const getResetTokenLink = (baseUrl, token, expiryMinutes = 60) => {
  const timestamp = Date.now();
  const payload = `${token}|${timestamp}|${expiryMinutes * 60 * 1000}`;
  const signature = crypto
    .createHmac('sha256', RESET_TOKEN_SECRET)
    .update(payload)
    .digest('hex');

  const securePath = `${payload}:${signature}`;
  return `${baseUrl}/instructor/set-password?code=${encodeURIComponent(securePath)}`;
};

export const verifyResetTokenCode = (code, tokenSecret) => {
  try {
    const parts = code.split(':');
    if (parts.length !== 2) return null;

    const [payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', tokenSecret)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) return null;

    const [token, timestamp, duration] = payload.split('|');
    const now = Date.now();
    const createdAt = parseInt(timestamp, 10);
    const expiryDuration = parseInt(duration, 10);

    if (now - createdAt > expiryDuration) return null;

    return token;
  } catch {
    return null;
  }
};
