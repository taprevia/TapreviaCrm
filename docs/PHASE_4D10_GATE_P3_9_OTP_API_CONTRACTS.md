# TAPREVIA — PHASE 4D.10 GATE P3.9
# OTP API CONTRACTS

All new endpoints are public auth endpoints under `/api/auth/password-reset`.
All responses are `Cache-Control: no-store`; none expose an OTP or user id.

## 1. Request OTP

`POST /api/auth/password-reset/request-otp`

```json
{ "email": "customer@example.com" }
```

Success — **200** (known, unknown, cooldown, per-email limit and provider failure
all return this generic shape):

```json
{
  "success": true,
  "expiresIn": 600,
  "resendAfter": 60,
  "message": "If an account exists for this email, a verification code will be sent."
}
```

- Invalid email → **400** `VALIDATION_ERROR`.
- IP abuse limit → **429** `RATE_LIMITED`.
- The response never contains the OTP, challenge id, user id or grant.
- Unknown/suspended accounts receive the same response and no email/challenge.

## 2. Resend OTP

`POST /api/auth/password-reset/resend-otp`

Same request/response contract as request-otp. It shares the same server-side
cooldown, four-send/15-minute limit, issuance lock and provider-failure behavior.

## 3. Verify OTP

`POST /api/auth/password-reset/verify-otp`

```json
{ "email": "customer@example.com", "otp": "123456" }
```

Success — **200**:

```json
{ "success": true, "grant": "<opaque 64-hex>", "expiresIn": 600 }
```

- Malformed input → **400** `VALIDATION_ERROR`.
- Wrong/expired/superseded/exhausted/cross-account code → **400** `BAD_REQUEST`
  with one generic message.
- Verify IP limit → **429** `RATE_LIMITED`.
- The grant is returned only in the JSON response body; it is never placed in a
  URL, cookie, localStorage or analytics.

## 4. Complete Reset

`POST /api/auth/password-reset/complete`

```json
{ "grant": "<opaque 64-hex>", "newPassword": "NewPass123!" }
```

Success — **200** `{ "success": true }`.

- Invalid, expired, reused, unverified or claimed grant → **400** `BAD_REQUEST`.
- Password fails the existing policy → **400** `VALIDATION_ERROR`.
- Confirmation is enforced in the browser; the server receives only the new
  password and validates it independently.
- A grant is scoped to the challenge/user; no email is accepted here, so it
  cannot be substituted across accounts.

## 5. Legacy contracts — unchanged

- `POST /api/auth/forgot-password` — still sends the legacy reset link.
- `POST /api/auth/reset-password` — still consumes legacy hashed tokens.
- `POST /api/admin/users/[id]/reset-password` — admin `email` mode still sends
  the legacy reset link; `temp` mode unchanged.
- `/reset-password?token=...` page unchanged.
- Invalid-session API requests still return **401 JSON** (not a 307 redirect).

## 6. Response headers

Every new endpoint sets `Cache-Control: no-store`. Error bodies use the existing
`{ error, code, details? }` convention.

**P3.9 OTP IMPLEMENTATION COMPLETE — LOCAL TESTS AND BACKWARD COMPATIBILITY PASSED**

