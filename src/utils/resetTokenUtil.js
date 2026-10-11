import crypto from 'crypto';
import { timingSafeEqual } from 'crypto';

// Read lazily (env may load after this module) and never fall back to a public
// constant: without RESET_TOKEN_SECRET, derive a server-only pepper from JWT_SECRET.
let warnedMissingSecret = false;
const resetTokenSecret = () => {
  if (process.env.RESET_TOKEN_SECRET) return process.env.RESET_TOKEN_SECRET;
  if (!warnedMissingSecret && process.env.NODE_ENV === 'production') {
    console.error('RESET_TOKEN_SECRET is not set — deriving reset-token pepper from JWT_SECRET. Set it explicitly.');
    warnedMissingSecret = true;
  }
  return crypto.createHash('sha256').update(`reset-token:${process.env.JWT_SECRET || ''}`).digest('hex');
};

export const generateResetToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  return { token, hash };
};

export const hashToken = (token) => {
  return crypto
    .createHash('sha256')
    .update(token + resetTokenSecret())
    .digest('hex');
};

export const verifyResetToken = (providedToken, storedHash) => {
  const hash = hashToken(providedToken);
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
  } catch {
    return false;
  }
};

export const getResetTokenLink = (baseUrl, token, expiryMinutes = 60) => {
  const timestamp = Date.now();
  const payload = `${token}|${timestamp}|${expiryMinutes * 60 * 1000}`;
  const signature = crypto
    .createHmac('sha256', resetTokenSecret())
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

    try {
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
    } catch {
      return null;
    }

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
