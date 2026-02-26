# Coupon Codes Reference

## Valid Coupon Codes

All codes are hardcoded in `src/index.js → validCoupons`. Coupons are enforced server-side only — the frontend sends the code and the backend validates + applies it.

| Code | Discount | Valid Currencies | Occasion |
|---|---|---|---|
| `DIWALI10` | 10% | INR only | Diwali (Oct–Nov) |
| `HOLI5` | 5% | INR only | Holi (Mar) |
| `EID10` | 10% | AED only | Eid Al-Fitr / Eid Al-Adha |
| `RAMADAN8` | 8% | AED only | Ramadan |
| `XMAS10` | 10% | USD, GBP, EUR | Christmas |
| `THANKSGIVING7` | 7% | USD only | Thanksgiving |
| `EASTER6` | 6% | GBP, EUR | Easter |
| `NEWYEAR5` | 5% | Global (any) | New Year |

> Coupons with a currency constraint silently reject if the user's currency doesn't match. The `/api/coupons/validate` endpoint returns `{ valid: false, error: 'Coupon not valid for your region' }`.

## Backend Implementation (`src/index.js`)

```js
const validCoupons = {
  'DIWALI10':      { rate: 0.10, currencies: ['inr'] },
  'HOLI5':         { rate: 0.05, currencies: ['inr'] },
  'EID10':         { rate: 0.10, currencies: ['aed'] },
  'RAMADAN8':      { rate: 0.08, currencies: ['aed'] },
  'XMAS10':        { rate: 0.10, currencies: ['usd', 'gbp', 'eur'] },
  'THANKSGIVING7': { rate: 0.07, currencies: ['usd'] },
  'EASTER6':       { rate: 0.06, currencies: ['gbp', 'eur'] },
  'NEWYEAR5':      { rate: 0.05, currencies: null }, // null = global
};
```

## Coupon Validation Endpoint

```
POST /api/coupons/validate
Rate limit: 10 requests per IP per 15 minutes

Body: { "code": "DIWALI10", "currency": "inr" }

Responses:
  { "valid": true,  "code": "DIWALI10", "discountPercent": 10 }
  { "valid": false, "error": "Coupon not valid for your region" }
  { "valid": false }
  429 Too Many Requests (rate limit exceeded)
```

## Discount Application Order

Discounts compound sequentially — each is applied to the result of the previous:

1. **Enrollment type** (20% individual / 40% group 2–4 / 50% group 5+)
2. **Coupon** (applied to post-enrollment price)
3. **Referral** (applied to post-coupon price, capped at 50%)

### Example

```
Base:            ₹56,000
Individual 20%:  ₹44,800
DIWALI10 10%:    ₹40,320
Referral 10%:    ₹36,288

totalDiscountPercent = round(1 - 36288/56000) = 35%  (not 40%, because compounding)
```

## Testing a Coupon

```bash
curl -X POST http://localhost:5000/pricing/quote \
  -H "Content-Type: application/json" \
  -d '{
    "courseId": "GENAI101",
    "enrollmentType": "individual",
    "participants": 1,
    "couponCode": "DIWALI10",
    "currency": "inr"
  }'
```

Expected response:
```json
{
  "courseId": "GENAI101",
  "currency": "inr",
  "unitAmountMinor": 4032000,
  "originalUnitMinor": 5600000,
  "discountPercent": 20,
  "couponApplied": true,
  "couponCode": "DIWALI10",
  "couponDiscountPercent": 10,
  "totalDiscountPercent": 28
}
```

## Adding a New Coupon

Edit only `src/index.js → validCoupons`. No frontend changes needed — the backend is the single source of truth.

```js
'NEWSALE15': { rate: 0.15, currencies: ['usd', 'gbp'] },
```

## Related Files

- `src/index.js` — `validCoupons`, `computeQuote()`, `/api/coupons/validate`
- `PAYMENT_FIXES_SUMMARY.md` — pricing bug history
- `CLAUDE.md` — canonical coupon list for quick reference

---

**Last Updated:** February 26, 2026
