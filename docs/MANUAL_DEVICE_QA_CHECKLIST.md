# Manual Device QA Checklist — Review Assistant

**Status:** NOT TESTED in Phase 4D.8. This checklist is for an authorized tester
using physical devices after local/production-readiness approval.

## Devices and browsers

- [ ] Android phone — Chrome
- [ ] iPhone — Safari
- [ ] Android phone — TalkBack
- [ ] iPhone — VoiceOver
- [ ] Optional: Android/iPad tablet

## Test data

Use synthetic or approved test Cards/Standees only. Never post a real Google
review or interact with a customer’s real Google listing without approval.

## 1. QR scan

- [ ] Google Review Card QR opens `/review/{alias}`.
- [ ] Google Review NFC Plate QR opens the review host.
- [ ] Premium NFC Card QR/profile opens the profile and “Share your experience”
      entry appears only when entitled/enabled.
- [ ] Google Review Standee panel/slot QR reaches the review host when the
      Standee gate is ON; with gate OFF, it reaches the original destination.
- [ ] Existing printed QR/NFC codes were not reprinted or changed.

## 2. NFC tap

- [ ] Tap Google Review Card/Plate: review host opens.
- [ ] Tap Premium NFC Card: profile opens; review entry works.
- [ ] Standee NFC tap (where supported): expected destination.
- [ ] No redirect loop or broken URL.

## 3. Review generation

- [ ] Suggestions load and are readable.
- [ ] Category/language selection works.
- [ ] AI generation returns an editable draft or a safe unavailable message.
- [ ] Manual “Write my own review” works.
- [ ] Draft editing works with the mobile keyboard.
- [ ] No fabricated experience or forced positive wording.

## 4. Clipboard and Google continuation

- [ ] Copy succeeds; confirmation appears.
- [ ] Clipboard contains the edited draft.
- [ ] Clipboard failure shows a safe error and does not claim success.
- [ ] “Continue to Google Reviews” opens the configured destination.
- [ ] Popup-blocked behavior is understandable.
- [ ] Rapid double-tap does not create duplicate analytics.
- [ ] No automatic Google posting.

## 5. Review Management

- [ ] 320–430px layouts: no horizontal overflow.
- [ ] Tabs, category dropdown, language chips, tag inputs, Save/Cancel usable.
- [ ] Hybrid dialog scrolls; Save/Cancel reachable.
- [ ] Review Analytics tab: metric cards, filters, charts, product rows.
- [ ] Keyboard-only navigation and focus visible.

## 6. Screen reader

TalkBack and VoiceOver:

- [ ] Review page heading/instructions announced.
- [ ] Feedback textarea has an accessible label/description.
- [ ] Draft textarea announced as editable review draft.
- [ ] Copy and Google buttons have clear names.
- [ ] Tabs, filters, radio ranges and charts announced meaningfully.
- [ ] Error/status messages announced.
- [ ] Modal focus trap and focus restoration work.

## 7. Network/error states

- [ ] Offline/slow network shows a safe error/retry.
- [ ] AI unavailable does not fabricate a draft.
- [ ] Disabled/unavailable review host shows a neutral message.
- [ ] No private settings or tokens visible in the UI.

## 8. Result record

Record device, OS/browser version, viewport, screenshots, PASS/FAIL, and any
regression. Do not mark physical-device QA PASS from browser emulation.

## 9. Phase 4D.9 additions

Run these on physical devices only; mark emulation results separately.

- [ ] Card Builder at 320/375/390/430/768/1024/1440: no horizontal page scroll;
      tab rail scrolls inside its own row; every tab reachable by touch and by
      Tab key; focus ring visible.
- [ ] Concurrent activation is not a customer-facing action, but verify a
      repeated admin "Assign" on the same UID shows the 409 message and does not
      duplicate the product in My Products.
- [ ] Existing `/r/` and `/qr/` links still open the same destinations with all
      flags OFF.
- [ ] With the Standee flag ON (staging only), an eligible Standee opens the
      review host; an ineligible one keeps its legacy destination.
- [ ] Clipboard success and failure paths both produce truthful messaging.
- [ ] AI provider timeout/error shows a safe unavailable message; no draft is
      fabricated.
- [ ] Deleted-host analytics are not expected to appear; do not report missing
      deleted-host history as a regression.

## 10. Emulation vs physical evidence

The 4D.9 local run covered browser viewports and automated focus checks only.
Physical-device, NFC tap, real clipboard and screen-reader results remain
**NOT TESTED** until this checklist is executed and recorded.
