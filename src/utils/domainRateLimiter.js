import axios from "axios";

// In-memory per-domain rate limiter. Single-instance deployment (Railway) — no
// Redis-backed distributed limiter needed. Timestamp is updated *before* the
// request fires so concurrent same-domain calls don't both read a stale "no
// wait needed" state.
const lastRequestAt = new Map(); // hostname -> timestamp ms

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function throttledFetch(url, options = {}, { minIntervalMs = 3000 } = {}) {
  const hostname = new URL(url).hostname;

  const last = lastRequestAt.get(hostname) || 0;
  const wait = minIntervalMs - (Date.now() - last);
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt.set(hostname, Date.now());

  return axios.get(url, { validateStatus: () => true, ...options });
}

export function clearRateLimiterState() {
  lastRequestAt.clear();
}
