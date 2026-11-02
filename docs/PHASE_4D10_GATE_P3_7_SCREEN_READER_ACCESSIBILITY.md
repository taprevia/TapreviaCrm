# TAPREVIA — PHASE 4D.10 GATE P3.7
# SCREEN-READER ACCESSIBILITY

## 1. Result

**VoiceOver verification: NOT VERIFIED.**

- `/System/Library/CoreServices/VoiceOver.app` exists on this macOS host.
- Automated AppleScript access to System Events was rejected:
  `Not authorised to send Apple events to System Events. (-1743)`.
- No accessibility permission was granted or bypassed, and no auditory output
  could be verified.

No screen-reader claim is made anywhere in this gate.

## 2. What was verified instead

- axe-core 4.13.0: **0 violations** on 11 pages (login, public profile, review,
  dashboard, products, review management, standees, admin review library,
  admin user details, contacts, landing).
- Keyboard: login focus order and visible focus; dialog initial focus, focus
  trap, Escape close, focus restoration; rename Escape.
- 35 responsive checks, 0 overflow; 200% text resize, 0 overflow.
- Form labels/accessible names validated by axe and DOM checks.
- Dynamic status regions (`role=status`, `aria-live`) present in review flow.

## 3. Manual VoiceOver checklist for owner execution

1. Login: heading/landmark rotor, email/password labels, submit announcement.
2. Dashboard: primary navigation, one main landmark, product card names.
3. My Products: product names, destination links, rename dialog focus.
4. Product setup: form labels, save success/error announcements.
5. Review Management: tabs, select labels, save result.
6. Public Review: suggestion text, copy confirmation, Google handoff.
7. Admin User Details: sections, permanent URL copy feedback, modals.
8. Standee configuration: slot labels, destination save feedback.

Record VoiceOver version, browser, page, step, spoken output and any defect.

## 4. Unverified devices

VoiceOver macOS, iOS VoiceOver, Android TalkBack, NVDA/JAWS were not tested.
Automated checks do not prove full WCAG 2.2 AA conformance.

**P3.7 INCOMPLETE — REQUIRED VERIFICATION GAPS REMAIN**

