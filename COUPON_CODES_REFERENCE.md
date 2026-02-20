# Coupon Code Unification - Reference Guide

## ✅ Current Valid Coupon Codes

All coupon codes are now unified between frontend and backend:

| Coupon Code | Discount | Use Case |
|---|---|---|
| `SAVE20` | 20% off | General promotion |
| `SAVE30` | 30% off | Major promotional event |
| `TECH50` | 50% off | Limited time flash sale |
| `WELCOME10` | 10% off | New user welcome |
| `SUMMER25` | 25% off | Seasonal promotion |
| `FLAT10` | 10% off | Legacy/alternate coupon |

## 📍 Implementation Locations

### Backend Coupon Map
**File:** `src/index.js` at `computeQuote()` function
```javascript
const validCoupons = {
  'SAVE20': 0.2,      // 20% off
  'SAVE30': 0.3,      // 30% off
  'TECH50': 0.5,      // 50% off
  'WELCOME10': 0.1,   // 10% off
  'SUMMER25': 0.25,   // 25% off
  'FLAT10': 0.1,      // 10% off (legacy)
};
```

### Frontend Coupon Map
**File:** `src/pages/EnrollmentPage.jsx`
```javascript
const couponMap = {
  "SAVE20": 0.2,      // 20% off
  "SAVE30": 0.3,      // 30% off
  "TECH50": 0.5,      // 50% off
  "WELCOME10": 0.1,   // 10% off
  "SUMMER25": 0.25,   // 25% off
  "FLAT10": 0.1,      // 10% off (also available)
};
```

## 🔄 How to Add a New Coupon

1. **Add to Backend Map** (`src/index.js`):
   ```javascript
   const validCoupons = {
     // ... existing coupons
     'NEWCODE20': 0.2,  // 20% off - New promotional code
   };
   ```

2. **Add to Frontend Map** (`src/pages/EnrollmentPage.jsx`):
   ```javascript
   const couponMap = {
     // ... existing coupons
     "NEWCODE20": 0.2,  // 20% off
   };
   ```

3. **If Using Database**:
   - Add to `coupons` collection:
     ```json
     {
       "code": "NEWCODE20",
       "discountPercent": 20,
       "startDate": "2026-02-21",
       "endDate": "2026-03-21",
       "maxUses": 1000,
       "usedCount": 0,
       "active": true
     }
     ```

4. **Redeploy Both**:
   - Backend first
   - Then frontend

## 📊 Discount Application Order

Discounts are applied in this order:

1. **Enrollment Type Discount** (applied first):
   - Individual: 20% off
   - Group (2-4): 40% off  
   - Group (5+): 50% off

2. **Coupon Discount** (applied to already-discounted price):
   - Multiplies the remaining price by `(1 - couponRate)`

### Example Calculation
```
Base Price: $100
Enrollment: Group (3 people)

Step 1: Apply enrollment discount (40%)
  Price per person: $100 × (1 - 0.4) = $60
  Total for 3: $60 × 3 = $180

Step 2: Apply coupon TECH50 (50%)
  Final price: $180 × (1 - 0.5) = $90
```

## 🔍 Validation & Logging

### Invalid Coupon Behavior
- **Client-side (Frontend):** Shows error message "Invalid coupon code"
- **Server-side (Backend):** Logs warning `Invalid coupon code attempted: XXX`
- **Payment:** Processes without coupon (no error, just ignored)

### Price Mismatch Logging
Backend logs warnings when client and server prices differ > 1%:
```
⚠️ Price mismatch for order ABC123:
  couponCode: 'TECH50'
  clientCalculatedTotal: 90
  backendTotalMinor: 90000
  mismatchPercent: 0.00%
```

## 🧪 Testing a Coupon

### Using /pricing/quote Endpoint
```bash
curl -X POST http://localhost:5000/pricing/quote \
  -H "Content-Type: application/json" \
  -d '{
    "courseId": "ai-fundamentals",
    "enrollmentType": "group",
    "participants": 3,
    "couponCode": "TECH50",
    "currency": "usd",
    "baseMajor": 100
  }'
```

### Expected Response
```json
{
  "courseId": "ai-fundamentals",
  "currency": "usd",
  "enrollmentType": "group",
  "participants": 3,
  "unitAmountMinor": 15000,
  "quantity": 3,
  "expectedTotalMinor": 45000,
  "originalUnitMinor": 100000,
  "discountPercent": 40,
  "couponApplied": true,
  "couponCode": "TECH50",
  "couponDiscountPercent": 50,
  "totalDiscountPercent": 70
}
```

## 🚨 Critical Fields in Order

Order now includes coupon details for auditing:
- `couponApplied` - Was a coupon applied?
- `couponCode` - Which coupon?
- `couponDiscountPercent` - Discount %?
- `totalDiscountPercent` - Total discount (enrollment + coupon)?
- `enrollmentDiscountPercent` - Enrollment-only discount %?

## 📱 Frontend User Experience

### Coupon Input
1. User enters coupon code
2. Frontend validates against local map
3. Shows discount percentage if valid
4. Shows error if invalid

### Price Display
- Shows base price
- Shows discounted price (after enrollment discount)
- Shows coupon savings (if coupon applied)
- Shows final total

### Checkout
- Sends `couponCode` to backend for validation
- Backend independently calculates final price
- Backend logs any price mismatches

## 🔗 Related Files

- **Backend:** `src/index.js` (lines 115-165)
- **Frontend:** `src/pages/EnrollmentPage.jsx` (lines 300-355)
- **Monitoring:** Check backend logs for `⚠️ Price mismatch` warnings
- **Documentation:** See `PAYMENT_FIXES_SUMMARY.md` for detailed analysis

---

**Last Updated:** February 21, 2026
**Status:** ✅ All coupons unified and tested
