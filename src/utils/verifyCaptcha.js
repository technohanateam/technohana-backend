import axios from "axios";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare Turnstile. Fails closed in production when the secret is missing;
// outside production a missing secret skips the check so local dev needs no keys.
export const verifyCaptcha = async (token, remoteIp) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!token || typeof token !== "string") return false;

  try {
    const { data } = await axios.post(
      VERIFY_URL,
      new URLSearchParams({ secret, response: token, ...(remoteIp && { remoteip: remoteIp }) }),
      { timeout: 8000 }
    );
    return data?.success === true;
  } catch (err) {
    console.error("Captcha verification error:", err.message);
    return false;
  }
};
