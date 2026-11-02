# TAPREVIA — PHASE 4D.10 GATE P3.9
# EMAIL OTP FORGOT-PASSWORD IMPLEMENTATION

**Branch:** `Devlopment` · **HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Execution:** localhost, synthetic MongoDB, loopback Resend mock, P3.6 egress guard
**Final status:** **P3.9 OTP IMPLEMENTATION COMPLETE — LOCAL TESTS AND BACKWARD COMPATIBILITY PASSED**

## 1. Files created

- `src/models/PasswordResetOtp.ts` — OTP challenge + grant storage.
- `src/lib/validation/password-reset-otp.ts` — request/verify/complete schemas.
- `src/lib/services/password-reset-otp.ts` — CSPRNG OTP, HMAC, expiry, attempts,
  verification, grant claim/complete.
- `src/lib/services/password-reset-otp-http.ts` — rate limits, generic responses,
  no-store, route handlers.
- `src/app/api/auth/password-reset/request-otp/route.ts`
- `src/app/api/auth/password-reset/resend-otp/route.ts`
- `src/app/api/auth/password-reset/verify-otp/route.ts`
- `src/app/api/auth/password-reset/complete/route.ts`
- `scripts/test-phase4d10p3-otp.ts` — 24 API/DB scenarios.
- `scripts/test-phase4d10p3-otp-ui.ts` — 16 browser/axe/responsive workflows.

## 2. Files modified

- `src/app/(auth)/forgot-password/page.tsx` — replaced with the three-step UI.
- `src/lib/mail.ts` — added OTP template/sender; legacy functions unchanged.
- `src/models/index.ts` — registered the additive model.
- `package.json` — added `test:p39-otp` and `test:p39-otp-ui`.

No User schema, PasswordResetToken, product, route-identifier or environment
file was changed.

## 3. Experience

**Enter Email → Verify Six-Digit OTP → Create New Password → Success → Login.**

- Step 1: email + Send OTP, generic enumeration-safe response.
- Step 2: six-digit input, paste/backspace, verify, resend with 60s timer,
  Change Email, masked address, expired/invalid feedback.
- Step 3: new password + confirm, visibility toggle, existing policy, success.
- Grant is held only in React state; never in URL/storage/analytics.

## 4. Security model

| Control | Value |
|---|---|
| OTP | 6 digits from `crypto.randomInt` |
| OTP storage | HMAC-SHA-256 (JWT_SECRET + purpose + challenge id + email) |
| OTP expiry | 10 minutes |
| Attempts | 5, atomic |
| Resend cooldown | 60 seconds |
| Send limit | 4/15m/email (initial + 3 resends) |
| IP limits | 20 request/15m; 30 verify/15m |
| Grant | 32 random bytes; SHA-256 stored; 10 min; single use |
| Grant claim | Atomic; rollback on save failure; 2-min stale recovery |
| Superseding | Only newest successfully delivered OTP valid |
| Provider failure | Prior OTP preserved; generic response |
| Enumeration | Same response for known/unknown/suspended/limit/failure |
| Logging | No OTP, grant or full recipient email in new OTP logs |
| Cache | `no-store` on all new endpoints |

## 5. Database

New `passwordresetotps` collection with TTL `purgeAt`, email/createdAt index,
grantHash unique sparse index. Legacy `passwordresettokens` untouched. No
destructive migration.

## 6. Preserved legacy behavior

- `POST /api/auth/forgot-password` and `/api/auth/reset-password` unchanged.
- `/reset-password?token=` page unchanged.
- Admin reset-by-email unchanged.
- Invalid-session API still returns 401 JSON.

## 7. Verification summary

- OTP API/DB: **24/24**.
- OTP UI: **16/16**; axe 0 on three steps; 7 widths + 200% resize.
- Legacy password reset: **18/18**.
- Mail provider: **21/21**.
- Auth: **7/7**.
- P3.5 write/UI: **56/56, 29/29**.
- BC OFF/ON: **11/11, 11/11**; URL **15/15**.
- 4D.5 **57/57 ×2**; 4D.6 **20/20 ×4**; 4D.7 **9/9**; matrix **192/192**.
- Entitlement 130, VCF 69, security 24/24, reliability 11/11.
- Typecheck/lint/build (normal and no-runtime-env) pass; `git diff --check` clean.

## 8. Final status

**P3.9 OTP IMPLEMENTATION COMPLETE — LOCAL TESTS AND BACKWARD COMPATIBILITY PASSED**

Real Resend inbox delivery remains **NOT VERIFIED** (mock only). Existing
sessions are not revoked on reset; this remains a separate approved security
action.
