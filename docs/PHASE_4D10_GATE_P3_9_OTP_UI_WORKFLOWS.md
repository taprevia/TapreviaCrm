# TAPREVIA — PHASE 4D.10 GATE P3.9
# OTP UI WORKFLOWS

**Result:** 16/16 browser workflows passed; axe 0 on all three steps; 7
responsive widths and 200% text resize pass.

## 1. Screens

| Step | Screen | Key controls |
|---|---|---|
| 1 | Forgot Password? | Email Address, Send OTP, Back to Login |
| 2 | Verify Your Email | 6-digit code, Verify OTP, Resend Code/timer, Change Email, masked email |
| 3 | Create New Password | New Password, Confirm, visibility toggle, requirements, Reset Password |
| 4 | Password Reset Successfully | Back to Login |

The route remains `/forgot-password`; the grant is held only in React state and
never appears in the URL, storage or analytics. `/reset-password?token=` remains
untouched for legacy links.

## 2. Executed browser workflows

| ID | Workflow | Result |
|---|---|---|
| UI-01 | Open Forgot Password | PASS |
| UI-02 | Send OTP advances to verification; email subject/number found in mock provider | PASS |
| UI-03 | OTP input receives focus; resend countdown shown | PASS |
| UI-04 | Wrong OTP shows error and stays on step 2 | PASS |
| UI-05 | Correct OTP advances to password step | PASS |
| UI-06 | Password mismatch rejected client-side | PASS |
| UI-07 | Password visibility toggle works | PASS |
| UI-08 | Password reset succeeds | PASS |
| UI-09 | New password logs in from the UI → dashboard | PASS |
| UI-10 | Change Email returns to step 1 and clears OTP | PASS |
| UI-11 | Unknown email gets generic next step and no email | PASS |
| UI-12 | 320/375/390/430/768/1024/1440 px: 0 horizontal overflow | PASS |
| UI-13 | 200% text resize: 0 horizontal overflow | PASS |
| UI-AXE-step1 | axe WCAG 2.2 AA scan | 0 violations |
| UI-AXE-step2 | axe scan | 0 violations |
| UI-AXE-step3 | axe scan | 0 violations |

## 3. UX/accessibility details

- Explicit labels, `autoComplete="email"` / `one-time-code` / `new-password`.
- `inputMode="numeric"`, `pattern="[0-9]*"`, max length six; paste/backspace
  handled by a single native input.
- Incomplete codes block submission; disabled state while pending.
- `role="alert"` errors and `aria-live` status announcements.
- Focus moves to OTP, then new-password, then success heading.
- Resend timer is server-originated; client timer is visual only.
- Masked email avoids exposing the full address on screen.

## 4. Limitation

The browser test used the loopback mock Resend provider; real inbox delivery is
**NOT VERIFIED**.

**P3.9 OTP IMPLEMENTATION COMPLETE — LOCAL TESTS AND BACKWARD COMPATIBILITY PASSED**

