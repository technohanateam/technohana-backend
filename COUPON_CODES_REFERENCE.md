# Coupon Codes Reference

Coupons are enforced server-side. `src/index.js → validCoupons` is the source of truth for quote computation. The MongoDB `Coupon` collection mirrors these and drives the Admin UI — seed with `node seed-coupons.js`.

**Seasonal coupons are stored as inactive** in MongoDB. Activate them from Admin → Coupons a few days before each occasion, and deactivate after it passes.

---

## India (INR)

| Code | Discount | Occasion | When to activate |
|---|---|---|---|
| `NEWYEAR5` | 5% | New Year (Global) | Jan 1–15 |
| `REPUBLIC5` | 5% | Republic Day | Jan 24–31 |
| `PONGAL5` | 5% | Pongal / Makar Sankranti | Jan 13–16 |
| `HOLI5` | 5% | Holi | ~Mar 18–22 (date varies) |
| `BAISAKHI5` | 5% | Baisakhi | Apr 13–16 |
| `INDEPENDENCE8` | 8% | Independence Day | Aug 13–17 |
| `ONAM7` | 7% | Onam | ~Sep 5–15 (date varies) |
| `NAVRATRI8` | 8% | Navratri | ~Oct 2–12 (date varies) |
| `DIWALI10` | 10% | Diwali | ~Oct 20–Nov 5 (date varies) |

## UAE / Arab (AED)

| Code | Discount | Occasion | When to activate |
|---|---|---|---|
| `RAMADAN8` | 8% | Ramadan | Start of Ramadan (date varies) |
| `EID10` | 10% | Eid ul-Fitr / Eid al-Adha | Per Eid date (date varies) |
| `UAENATIONAL8` | 8% | UAE National Day | Nov 30–Dec 3 |

## US (USD)

| Code | Discount | Occasion | When to activate |
|---|---|---|---|
| `MEMORIALDAY5` | 5% | Memorial Day | Last weekend of May |
| `JUNETEENTH5` | 5% | Juneteenth | Jun 17–20 |
| `LABORDAY7` | 7% | Labor Day | First weekend of Sep |
| `HALLOWEEN5` | 5% | Halloween | Oct 28–Nov 1 |
| `THANKSGIVING7` | 7% | Thanksgiving | ~Nov 25–Dec 1 |
| `XMAS10` | 10% | Christmas | Dec 22–31 |

## UK / EU (GBP, EUR)

| Code | Discount | Occasion | When to activate |
|---|---|---|---|
| `STPATRICKS5` | 5% | St. Patrick's Day | Mar 15–18 |
| `EASTER6` | 6% | Easter | Good Friday → Easter Monday |
| `MAYBANK5` | 5% | May Bank Holiday | First Mon of May |
| `SUMMERLEARN7` | 7% | Summer Learning | Jun 1–Aug 31 |
| `XMAS10` | 10% | Christmas (shared with US) | Dec 22–31 |

## Global / Platform

| Code | Discount | Currencies | Status | Notes |
|---|---|---|---|---|
| `LAUNCH10` | 10% | All | Always-on active | Platform launch — keep active |
| `NEWYEAR5` | 5% | All | Jan 1–15 | New Year global offer |
| `FLASHSALE15` | 15% | All | Inactive | Activate manually for flash sales |
| `REFERRAL10` | 10% | All | Inactive | Activate per referral campaign |
| `B2B20` | 20% | All | Inactive | Share directly with corporate clients |

---

## Discount Application Order

Discounts compound sequentially:

1. **Enrollment type** — Individual 0% · Group 2–4 15% · Group 5–9 25% · Group 10+ 35%
2. **Coupon** (applied to post-enrollment price)
3. **Referral** (applied to post-coupon price, capped at 50%)

```
Base:            ₹56,000
Group-5 25%:     ₹42,000
DIWALI10 10%:    ₹37,800
Referral 10%:    ₹34,020
```

---

## Operations

**Seed all coupons to MongoDB:**
```bash
node seed-coupons.js
```

**Test a coupon:**
```bash
curl -X POST http://localhost:5000/pricing/quote \
  -H "Content-Type: application/json" \
  -d '{ "courseId": "GENAI101", "enrollmentType": "individual", "participants": 1, "couponCode": "DIWALI10", "currency": "inr" }'
```

**Adding a new coupon:**
1. Add to `src/index.js → validCoupons` (for quote engine)
2. Create via Admin → Coupons UI (for management)

---

## Related Files

- `src/index.js` — `validCoupons`, `computeQuote()`
- `src/models/coupon.model.js` — MongoDB schema
- `src/controllers/coupon.controller.js` — CRUD + validate
- `seed-coupons.js` — full annual seed script
- `PAYMENT_FIXES_SUMMARY.md` — pricing bug history

---

**Last Updated:** March 26, 2026
