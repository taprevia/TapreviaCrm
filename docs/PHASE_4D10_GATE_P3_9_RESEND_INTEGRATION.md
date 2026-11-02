# TAPREVIA — PHASE 4D.10 GATE P3.9
# RESEND INTEGRATION

## 1. Reuse

The existing `src/lib/mail.ts` Resend transport is reused. No second provider
was added. New functions:

- `buildPasswordResetOtpMail(to, otp)`
- `sendPasswordResetOtpEmail(to, otp, transport?)`

Existing `sendPasswordResetEmail()` is unchanged for legacy links and admin
reset-by-email.

## 2. Template

**Subject:** `Taprevia — Password Reset Verification Code`

Plain-text body contains the six-digit code, a 10-minute expiry statement, a
security warning not to share it, and the Taprevia signature. The code is
generated at request time; the template contains no fixed OTP.

## 3. Transport behavior

| Condition | Behavior |
|---|---|
| Production + valid `RESEND_API_KEY`/`EMAIL_FROM` | `resend.emails.send` |
| Missing key/sender | logs missing variable names; returns `ok:false`; no email |
| Provider rejection | logs provider name/message; returns `ok:false` |
| Provider throw/timeout | caught; returns `ok:false` |
| Development | OTP email suppressed; **no OTP is logged** |
| Provider failure during resend | pending challenge removed; prior OTP preserved |

The OTP route keeps the generic customer response on provider failure. It logs
the challenge id, not the OTP or full email.

## 4. Mocked test delivery

`RESEND_BASE_URL` is a native Resend SDK override. Tests set it to
`http://127.0.0.1:3999`, where a loopback mock accepts `/emails` and exposes
captured messages only to the local test process. The P3.6 egress guard blocks
all non-loopback traffic.

- API tests: 24/24.
- Browser tests: 16/16.
- Captured OTP email subject/number verified.
- No real Resend API call was made.
- **Real inbox delivery is NOT VERIFIED.**

## 5. Environment variables

Required (unchanged): `RESEND_API_KEY`, `EMAIL_FROM`.
Test-only optional: `RESEND_BASE_URL` (SDK-native; never required in Vercel).
`NEXT_PUBLIC_BASE_URL` is not used by the OTP flow.
No new required production variable was introduced.

## 6. Remaining external risk

Domain verification, DKIM/SPF, sender acceptance, inbox/spam placement and
provider latency can only be verified with an approved Resend test send.

**P3.9 OTP IMPLEMENTATION COMPLETE — LOCAL TESTS AND BACKWARD COMPATIBILITY PASSED**

