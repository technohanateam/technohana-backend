# Independent Security Audit Report - Sprint 1
**Date:** 2024-07-02  
**Auditor Role:** Independent Security Reviewer (Not trusting implementation)  
**Status:** 🔴 **CRITICAL ISSUES FOUND - APPROVAL CONDITIONAL**

---

## Executive Summary

While the Sprint 1 implementation addresses the targeted vulnerabilities, the audit identified **9 additional security issues** ranging from CRITICAL to MEDIUM severity. These issues were NOT in the original vulnerability list but were introduced or exposed by the changes.

**Recommendation:** Fix all CRITICAL and HIGH issues before production deployment.

---

## CRITICAL VULNERABILITIES DISCOVERED

### 🔴 CRITICAL #1: Email Case Sensitivity Bypass in Admin Authentication
**File:** `src/controllers/adminUser.controller.js:47, 75`  
**Severity:** CRITICAL  
**Impact:** Authentication Bypass / Inconsistent Behavior  

**Issue:**
```javascript
// Line 47: Database lookup (case-insensitive)
const normalizedEmail = String(email).toLowerCase().trim();
const dbUser = await AdminUser.findOne({ email: normalizedEmail });

// Line 75: Env-var lookup (case-sensitive!)
const envRole = await matchEnvRole(email, password); // <- ORIGINAL email, not normalized
```

In `matchEnvRole` (line 17):
```javascript
if (email === process.env.ADMIN_EMAIL && ...) // Strict ===, case-sensitive
```

**Attack Scenario:**
- `ADMIN_EMAIL=admin@example.com` in env vars
- User attempts login with `Admin@example.com`
- Database lookup succeeds (normalized to lowercase)
- Env-var lookup FAILS (strict case match)
- Inconsistent authentication behavior

**Fix:**
```javascript
// Option 1: Pass normalized email
const envRole = await matchEnvRole(normalizedEmail, password);

// Option 2: Normalize in matchEnvRole
const matchEnvRole = async (email, password) => {
  const normalizedEmail = String(email).toLowerCase().trim();
  if (normalizedEmail === process.env.ADMIN_EMAIL?.toLowerCase() && ...) {
```

---

### 🔴 CRITICAL #2: Encryption Key Generation on Every Startup
**File:** `src/utils/tokenCrypto.js:9-15`  
**Severity:** CRITICAL  
**Impact:** Token Decryption Failure, Data Loss  

**Issue:**
```javascript
const ENCRYPTION_KEY = process.env.ENROLLMENT_TOKEN_KEY || crypto.randomBytes(keyLength);

const deriveKey = (salt) => {
  if (!process.env.ENROLLMENT_TOKEN_KEY) {
    return ENCRYPTION_KEY; // <- Returns random key from startup
  }
  return crypto.pbkdf2Sync(process.env.ENROLLMENT_TOKEN_KEY, salt, 100000, keyLength, 'sha256');
};
```

**Problem:**
1. If `ENROLLMENT_TOKEN_KEY` not set, random key generated once at startup
2. On app restart (or multiple instances), different key is used
3. **All previously encrypted tokens become UNDECRYTABLE**
4. Enrollment tokens become permanently invalid after restart

**Attack Scenario:**
- User enrolls for course, gets encrypted enrollment token
- App restarts (bug fix, deployment, etc.)
- New random key generated
- Old enrollment tokens fail to decrypt
- User's enrollment is lost/broken

**Fix:**
```javascript
// REQUIRED environment variable (fail fast if missing)
const ENCRYPTION_KEY = process.env.ENROLLMENT_TOKEN_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENROLLMENT_TOKEN_KEY environment variable is required');
}

const deriveKey = (salt) => {
  return crypto.pbkdf2Sync(ENCRYPTION_KEY, salt, 100000, keyLength, 'sha256');
};
```

---

### 🔴 CRITICAL #3: Timing Attack Vulnerabilities in Token Verification
**File:** `src/utils/resetTokenUtil.js:20, 46`  
**Severity:** CRITICAL  
**Impact:** Token Brute-Force via Timing Side-Channel  

**Issue:**
```javascript
// Line 20: NOT timing-safe
return hash === storedHash; // Vulnerable to timing attacks

// Line 46: NOT timing-safe
if (signature !== expectedSignature) return null; // Vulnerable
```

**Problem:**
- String comparison `===` returns false early on first difference
- Attacker can measure response time to find correct characters
- By testing 256 values for each byte, attacker leaks hash character-by-character
- With 256-bit hash, attacker needs ~256 * 32 * 1000 = ~8 million requests (feasible with rate limiting disabled)

**Fix:**
```javascript
import { timingSafeEqual } from 'crypto';

export const verifyResetToken = (providedToken, storedHash) => {
  const hash = hashToken(providedToken);
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
  } catch {
    return false; // Lengths don't match
  }
};
```

---

### 🔴 CRITICAL #4: N+1 Query / DoS Vulnerability in Password Reset
**File:** `src/routes/instructor.routes.js:61-71`  
**Severity:** CRITICAL  
**Impact:** Performance Degradation, Denial of Service  

**Issue:**
```javascript
// Fetches ALL instructors with non-expired tokens (could be 1000+)
const instructors = await Instructor.find({
  resetTokenExpiry: { $gt: new Date() },
});

// Then loops through ALL and does expensive hash verification
let instructor = null;
for (const inst of instructors) {
  if (inst.resetToken && verifyResetToken(token, inst.resetToken)) {
    instructor = inst;
    break;
  }
}
```

**Problem:**
1. Fetches ALL (potentially thousands) of instructors
2. For each one, calls `verifyResetToken()` which does SHA256 hashing
3. O(n) database operations per request where n = number of pending resets
4. Attacker can trigger this by requesting password reset without setting password
5. Expensive hashing operation repeated for every record

**Attack Scenario:**
- Attacker triggers 1000 password resets
- When next user tries to reset password, server fetches 1000 records
- Performs 1000 hash comparisons
- Server becomes slow/unresponsive

**Fix:**
```javascript
// Query directly by hash
const instructor = await Instructor.findOne({
  resetToken: hash,
  resetTokenExpiry: { $gt: new Date() },
});

if (!instructor) {
  return res.status(400).json({ success: false, message: "Invalid or expired link" });
}
```

---

### 🔴 CRITICAL #5: Missing Rate Limiting on Admin Login
**File:** `src/routes/admin.routes.js:41`  
**Severity:** CRITICAL  
**Impact:** Brute-Force Authentication Attack  

**Issue:**
```javascript
router.post("/login", adminLogin); // NO rate limiting
```

**Problem:**
- Admin login endpoint has no rate limiting
- Attacker can attempt unlimited login attempts
- Can brute-force admin credentials
- No protection against dictionary attacks

**Comparison:**
- Token refresh has rate limiting (5 per 15 min) ✓
- Admin login has NO rate limiting ✗

**Fix:**
```javascript
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many login attempts, please try again later",
  skipSuccessfulRequests: true, // Don't count successful logins
});

router.post("/login", adminLoginLimiter, adminLogin);
```

---

## HIGH SEVERITY VULNERABILITIES DISCOVERED

### 🟠 HIGH #1: Missing Rate Limiting on Password Reset Endpoints
**File:** `src/routes/instructor.routes.js:53, 83`  
**Severity:** HIGH  
**Impact:** Email Spam DoS, User Enumeration  

**Issue:**
```javascript
router.post("/auth/set-password", async (req, res) => { // NO rate limit
router.post("/auth/forgot-password", async (req, res) => { // NO rate limit
```

**Attack Scenarios:**
1. **Email DoS:** Attacker spams reset emails to legitimate instructors
2. **User Enumeration:** Attacker can discover which emails are registered by timing differences
3. **System Overload:** 1000 reset emails overwhelm mail server

**Fix:**
```javascript
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  skipSuccessfulRequests: false,
});

router.post("/auth/forgot-password", passwordResetLimiter, async (req, res) => {
```

---

### 🟠 HIGH #2: NODE_ENV Fallback in CORS Configuration
**File:** `src/index.js:68`  
**Severity:** HIGH  
**Impact:** Unintended CORS Bypass in Production  

**Issue:**
```javascript
if (!origin) {
  if (process.env.NODE_ENV === 'production') {
    return callback(new Error("Origin required in production"));
  }
  return callback(null, true); // Allow if NOT production
}
```

**Problem:**
- If `NODE_ENV` is not set, `NODE_ENV !== 'production'` is TRUE
- This means DEVELOPMENT rules apply
- Development rules allow no-origin requests
- If deployed without setting NODE_ENV, CORS is wide open

**Scenario:**
- Production deployment doesn't set NODE_ENV variable
- CORS allows all no-origin requests
- Mobile apps, scripts, and curl all work without origin
- Security weakens silently

**Fix:**
```javascript
// Treat undefined as production-safe
const isProd = process.env.NODE_ENV === 'production' || 
               process.env.NODE_ENV === 'prod' ||
               process.env.NODE_ENV === undefined; // Default to strict

if (!origin && isProd) {
  return callback(new Error("Origin required in production"));
}
```

---

### 🟠 HIGH #3: WHITELISTED_URLS Trailing Slash Mismatch
**File:** `src/index.js:73`  
**Severity:** HIGH  
**Impact:** CORS Requests Rejected Due to URL Format  

**Issue:**
```javascript
if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
  return callback(null, true);
}
```

**Problem:**
- If `WHITELISTED_URLS=http://example.com/` (with trailing slash)
- But browser sends `origin: http://example.com` (no trailing slash)
- String comparison fails
- Legitimate request rejected

**Fix:**
```javascript
const normalizeUrl = (url) => {
  return url.replace(/\/$/, ''); // Remove trailing slash
};

const allowedOrigins = process.env.WHITELISTED_URLS
  ? process.env.WHITELISTED_URLS.split(',').map(url => normalizeUrl(url.trim()))
  : [];

// Then in CORS check:
const normalizedOrigin = origin.replace(/\/$/, '');
if (allowedOrigins.includes(normalizedOrigin)) {
  return callback(null, true);
}
```

---

### 🟠 HIGH #4: Incomplete XSS Prevention - HTML Entities Not Handled
**File:** `src/utils/inputValidator.js:3, 27-29`  
**Severity:** HIGH  
**Impact:** XSS Bypass via HTML Entities  

**Issue:**
```javascript
const XSS_CHARS_REGEX = /[<>\"'`]/g;

export const sanitizeString = (str) => {
  if (typeof str !== 'string') return '';
  return str.trim().replace(XSS_CHARS_REGEX, '');
};
```

**Problem:**
- Only removes literal characters: `< > " ' \``
- Doesn't handle HTML entities: `&lt;` `&#60;` `&#x3c;`
- Doesn't handle URL encoding: `%3c` `%3e`
- Doesn't handle Unicode escapes: `<`

**Attack:**
```
Input: "John&lt;script&gt;alert('xss')&lt;/script&gt;"
Validation: Passes (no literal < or > characters)
Stored: "John&lt;script&gt;alert('xss')&lt;/script&gt;"
Rendered: Browser decodes HTML entities and executes script
```

**Fix:**
```javascript
import DOMPurify from 'dompurify'; // Or similar
// OR
export const sanitizeString = (str) => {
  return str
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};
```

---

## MEDIUM SEVERITY VULNERABILITIES DISCOVERED

### 🟡 MEDIUM #1: Default Secret in resetTokenUtil
**File:** `src/utils/resetTokenUtil.js:3`  
**Severity:** MEDIUM  
**Impact:** Token Verification Uses Weak Default Secret  

**Issue:**
```javascript
const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || 'reset-token-secret';
```

**Problem:**
- If `RESET_TOKEN_SECRET` not set, uses hardcoded default
- All tokens use same weak secret
- If source code is leaked, secret is known to attacker

**Fix:**
```javascript
const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET;
if (!RESET_TOKEN_SECRET) {
  throw new Error('RESET_TOKEN_SECRET environment variable is required');
}
```

---

### 🟡 MEDIUM #2: Unused Functions in resetTokenUtil
**File:** `src/utils/resetTokenUtil.js:23-59`  
**Severity:** MEDIUM  
**Impact:** Code Maintenance, Unclear Intent  

**Issue:**
- `getResetTokenLink()` function exists but isn't used
- `verifyResetTokenCode()` function exists but isn't used
- Implementation uses different approach via `generateResetToken()` and `verifyResetToken()`

**Impact:**
- Dead code causes confusion
- Maintenance burden
- Two different token mechanisms (unused getResetTokenLink vs used generateResetToken)

**Fix:**
- Remove unused functions or clarify their purpose with comments
- Consolidate to single token generation approach

---

### 🟡 MEDIUM #3: Bcrypt Salt Rounds Inconsistency
**File:** `src/controllers/adminUser.controller.js:129` vs `src/routes/instructor.routes.js:76`  
**Severity:** MEDIUM  
**Impact:** Inconsistent Security Level  

**Issue:**
```javascript
// Admin passwords: 10 rounds (line 129)
const passwordHash = await bcrypt.hash(password, 10);

// Instructor passwords: 12 rounds (line 76)
const passwordHash = await bcrypt.hash(password, 12);
```

**Problem:**
- 10 rounds takes ~100ms to hash
- 12 rounds takes ~250ms to hash
- Instructor passwords are harder to crack than admin passwords
- Inconsistent security posture

**Fix:**
- Use consistent salt rounds (10-12 are both acceptable, pick one)
- Preferably 12 for both (more secure)

---

## VALIDATION OF ORIGINAL FIXES

### ✅ Vulnerability #1: Unauthenticated Data Exposure
- **Status:** FIXED and WORKING
- **But:** Must verify authenticateJWT is applied to ALL sensitive endpoints

### ✅ Vulnerability #2: Plaintext Password Comparison
- **Status:** FIXED but HAS ISSUES (Email case sensitivity, see CRITICAL #1)

### ✅ Vulnerability #3: Base64 Tokens Not Encrypted
- **Status:** FIXED but HAS CRITICAL ISSUE (Random key on restart, see CRITICAL #2)

### ✅ Vulnerability #4: NoSQL Injection via $regex
- **Status:** FIXED and WORKING
- **Regex escaping is correct and complete**

### ⚠️ Vulnerability #5: Sensitive Logging
- **Status:** FIXED for WHITELISTED_URLS
- **But:** Check for other logs that might leak secrets

### ⚠️ Vulnerability #6: Weak CORS
- **Status:** PARTIALLY FIXED with CRITICAL ISSUE (NODE_ENV fallback, see HIGH #2)

### ⚠️ Vulnerability #7: Missing Rate Limiting
- **Status:** PARTIALLY FIXED
- **Problem:** Token refresh has rate limiting but admin login doesn't (see CRITICAL #5)

### ✅ Vulnerability #8: Sensitive Token Logging
- **Status:** FIXED
- **No token logging in OAuth callback**

### ⚠️ Vulnerability #9: Missing Input Validation
- **Status:** PARTIALLY FIXED with ISSUES
- **Problem:** XSS prevention incomplete (see HIGH #4)

### ⚠️ Vulnerability #10: Insecure Password Reset Tokens
- **Status:** PARTIALLY FIXED with CRITICAL ISSUES
- **Problems:** Timing attacks (CRITICAL #3), N+1 queries (CRITICAL #4)

---

## SUMMARY TABLE

| ID | Issue | Severity | Status | Impact |
|----|-------|----------|--------|--------|
| CRITICAL #1 | Email case sensitivity | CRITICAL | NEW | Auth bypass |
| CRITICAL #2 | Token key generation | CRITICAL | NEW | Data loss |
| CRITICAL #3 | Timing attacks | CRITICAL | NEW | Token brute-force |
| CRITICAL #4 | N+1 query DoS | CRITICAL | NEW | Performance/DoS |
| CRITICAL #5 | Missing login rate limit | CRITICAL | NEW | Brute-force |
| HIGH #1 | Password reset rate limit | HIGH | NEW | Email DoS |
| HIGH #2 | NODE_ENV fallback | HIGH | NEW | CORS bypass |
| HIGH #3 | URL trailing slash | HIGH | NEW | CORS rejection |
| HIGH #4 | HTML entity XSS | HIGH | NEW | XSS bypass |
| MEDIUM #1 | Default secret | MEDIUM | NEW | Weak crypto |
| MEDIUM #2 | Unused functions | MEDIUM | NEW | Code quality |
| MEDIUM #3 | Bcrypt rounds | MEDIUM | NEW | Inconsistency |

---

## RECOMMENDATIONS

### IMMEDIATE (Before Any Production Use):
1. **Fix CRITICAL #1** - Email case normalization (5 min)
2. **Fix CRITICAL #2** - Require ENROLLMENT_TOKEN_KEY env var (10 min)
3. **Fix CRITICAL #3** - Use timingSafeEqual() (15 min)
4. **Fix CRITICAL #4** - Query directly instead of N+1 (20 min)
5. **Fix CRITICAL #5** - Add rate limiting to admin login (10 min)

### BEFORE SPRINT 2:
1. **Fix HIGH #1** - Rate limit password reset (10 min)
2. **Fix HIGH #2** - Fix NODE_ENV fallback (10 min)
3. **Fix HIGH #3** - Handle URL trailing slashes (10 min)
4. **Fix HIGH #4** - Implement proper HTML sanitization (20 min)

### NICE TO HAVE:
1. **Fix MEDIUM #1** - Require RESET_TOKEN_SECRET env var
2. **Fix MEDIUM #2** - Remove unused functions
3. **Fix MEDIUM #3** - Standardize bcrypt salt rounds

---

## FINAL VERDICT

🔴 **APPROVAL REJECTED - CRITICAL ISSUES MUST BE FIXED**

The Sprint 1 implementation successfully addresses the original 10 vulnerabilities but introduces 9 new security issues, with 5 at CRITICAL severity. These are not edge cases - they are fundamental flaws in the implementation:

1. **Authentication can be bypassed** (email case)
2. **Tokens become undecrytable** (random key)
3. **Tokens can be brute-forced** (timing attacks)
4. **System can be DoS'd** (N+1 queries)
5. **Admin accounts can be brute-forced** (no rate limiting)

**Estimated Fix Time:** 2-3 hours for all CRITICAL and HIGH issues

**Recommendation:** Fix issues, re-audit, THEN proceed to Sprint 2.

---

**Audit Date:** 2024-07-02  
**Auditor:** Independent Security Review  
**Status:** CONDITIONAL APPROVAL (requires fixes)
