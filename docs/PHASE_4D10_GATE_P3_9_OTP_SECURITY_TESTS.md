# TAPREVIA — PHASE 4D.10 GATE P3.9
# OTP SECURITY TESTS

**Result:** 24/24 API/DB security scenarios passed; 16/16 browser workflows
passed; 0 failures.

## 1. OTP design

| Control | Implementation |
|---|---|
| Format | Six numeric digits, `crypto.randomInt(0, 1_000_000)` |
| Entropy | Uniform 000000–999999 from platform CSPRNG |
| Storage | HMAC-SHA-256 with `JWT_SECRET`, purpose-separated with challenge id + normalized email; no plaintext |
| Expiry | 10 minutes |
| Attempts | 5 per challenge; atomic increment |
| Resend cooldown | 60 seconds server-side |
| Send limit | 4 issuances / 15 minutes / email (initial + 3 resends) |
| IP limits | 20 requests / 15 minutes; 30 verifies / 15 minutes |
| Superseding | New successfully delivered OTP supersedes older active OTP |
| Failed provider send | Pending challenge discarded; previous OTP remains valid |
| Grant | 32 random bytes, SHA-256 hash stored, 10-minute expiry, single use |
| Grant claim | Atomic claim with 2-minute stale-claim recovery; rolled back on password-save failure |
| Replay | Verified challenge cannot be verified again; used grant rejected |
| Enumeration | Generic request/resend response for known, unknown, suspended, cooldown, limit and provider failure |
| Logging | No OTP, grant or full recipient email in new OTP logs |

## 2. Executed scenarios

| ID | Scenario | Result |
|---|---|---|
| OTP-01 | OTP email has six digits; DB stores 64-char HMAC, not plaintext | PASS |
| OTP-03 | Request response generic, no OTP/grant, `no-store` | PASS |
| OTP-04 | Unknown email: identical response, no mail, no challenge | PASS |
| OTP-05 | Wrong OTP rejected and attempt incremented | PASS |
| OTP-06 | Correct OTP issues grant; only grant hash stored | PASS |
| OTP-07 | Verify response `no-store` | PASS |
| OTP-08 | Complete changes hash; new login works; old fails | PASS |
| OTP-09 | Grant replay rejected | PASS |
| OTP-10 | OTP cannot be verified twice | PASS |
| OTP-11 | Complete without real grant rejected | PASS |
| OTP-12 | Expired OTP rejected | PASS |
| OTP-13 | Five real wrong attempts lock even the correct code | PASS |
| OTP-14 | 60s resend cooldown enforced server-side | PASS |
| OTP-15 | New OTP supersedes old; old code fails | PASS |
| OTP-16 | Provider failure preserves usable prior OTP | PASS |
| OTP-17 | Concurrent verification yields exactly one grant | PASS |
| OTP-18 | Cross-account OTP rejected | PASS |
| OTP-19 | Expired grant rejected | PASS |
| OTP-20 | Legacy reset-link endpoint still works | PASS |
| OTP-21 | Admin reset-by-email still sends legacy link | PASS |
| OTP-22 | Malformed email/OTP/password → 400 | PASS |
| OTP-23 | No OTP value in service logs | PASS |
| OTP-24 | Four issuances/15m limit (initial + 3 resends) | PASS |
| OTP-25 | Concurrent completion allows exactly one reset | PASS |

## 3. Additional guarantees

- New endpoints do not use cookies/session state; grants are bearer secrets.
- No OTP/grant in browser storage, URL, analytics or response logs.
- Existing invalid-session API behavior remains **401 JSON**.
- Password policy is unchanged (8–128, letter + number).

## 4. Limitations

- Real Resend delivery and provider timeout behavior were **not** tested; the
  Resend SDK was pointed at a loopback mock via `RESEND_BASE_URL`.
- Existing JWT sessions are not revoked after a password reset. This is a
  separate auth-architecture action (session/versioning), not a regression.
- A process crash after the grant claim but before the password save can delay
  retry for up to 2 minutes; normal DB-save failures roll the claim back.

**P3.9 OTP IMPLEMENTATION COMPLETE — LOCAL TESTS AND BACKWARD COMPATIBILITY PASSED**

