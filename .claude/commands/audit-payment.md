Audit the payment and pricing system in technohana-backend.

$ARGUMENTS

Check each item and report PASS or FAIL with line numbers:

1. `src/index.js` → `computeQuote()`: discount chain is Individual=0%, Group 2-4=15%, Group 5-9=25%, Group 10+=35%, then coupon (from DB), then referral (capped 50%)

2. Stripe route: calls `computeQuote()` server-side and compares against `backendTotalMinor` before creating payment intent. Never uses the price value from the request body.

3. Razorpay route: same — server recomputes price, does not use client-supplied amount.

4. Coupon validation: `Coupon.findOne({ code })` checks `isActive`, `isExpired()`, `isExhausted()`, `isValidForCurrency()`. No coupon codes are hardcoded.

5. After successful payment (webhook confirmed): `incrementCouponUsage()` is called. This must happen after webhook confirmation, not just after form submission.

6. `priceCatalog` in `src/index.js`: spot-check 2-3 courses — INR values are in paise (₹ × 100), USD in cents.

7. Payment webhook security:
   - Stripe: `stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET)` present
   - Razorpay: `x-razorpay-signature` header verified
