// Integer minor-unit money helpers. Never use floats for stored or summed money.

const MINOR_EXPONENT = { INR: 2, USD: 2, AED: 2, GBP: 2, EUR: 2 };

export const minorExponent = (currency) => MINOR_EXPONENT[String(currency || "").toUpperCase()] ?? 2;

const assertInt = (n) => {
  if (!Number.isSafeInteger(n)) throw new TypeError(`Expected integer minor units, got ${n}`);
  return n;
};

// Convert a major-unit amount (e.g. 1499.5) to minor units, rounding half away from zero.
export function toMinor(major, currency = "INR") {
  const n = Number(major);
  if (!Number.isFinite(n)) return 0;
  const scaled = Math.abs(n) * 10 ** minorExponent(currency);
  const rounded = Math.round(Number((scaled).toPrecision(15)));
  return n < 0 ? -rounded : rounded;
}

export const add = (a, b) => assertInt(a) + assertInt(b);
export const sub = (a, b) => assertInt(a) - assertInt(b);

// amountMinor * bp / 10000, rounded half away from zero (bp = basis points, 1800 = 18%).
export function mulBp(amountMinor, bp) {
  assertInt(amountMinor);
  assertInt(bp);
  const product = Math.abs(amountMinor) * Math.abs(bp);
  const q = Math.floor(product / 10000);
  const r = product % 10000;
  const rounded = r * 2 >= 10000 ? q + 1 : q;
  return amountMinor * bp < 0 ? -rounded : rounded;
}

// Split amountMinor by integer weights so the parts always sum exactly (largest remainder).
export function allocate(amountMinor, weights) {
  assertInt(amountMinor);
  const total = weights.reduce((s, w) => s + assertInt(w), 0);
  if (total <= 0) throw new RangeError("Weights must sum to a positive integer");
  const base = weights.map((w) => Math.floor((amountMinor * w) / total));
  let left = amountMinor - base.reduce((s, v) => s + v, 0);
  const order = weights
    .map((w, i) => ({ i, rem: (amountMinor * w) % total }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) base[order[k].i] += 1;
  return base;
}
