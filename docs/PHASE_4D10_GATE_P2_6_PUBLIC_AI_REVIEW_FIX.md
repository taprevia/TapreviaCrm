# TAPREVIA — PHASE 4D.10 GATE P2.6 PUBLIC AI REVIEW FIX

**Status:** LOCAL AI REVIEW REPAIR COMPLETE — PREVIEW VERIFICATION REQUIRED
**Branch:** `Devlopment`
**HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Production:** untouched
**Remote databases / Vercel:** not accessed or modified

---

## 1. Screenshot scenario reproduced

Public path: `/review/grc-review` (same flow as `/review/digital-mvv8fuge7n`).

Input: `good exp` (8 characters), Language `English`, Length `Short`.

**Before repair:** the AI entry opened the manual composer but the
**Generate Review** button was disabled with no exact requirement. The hint only
said “A little more detail helps us phrase it accurately.”

**Verified cause:** both the client and the generate APIs required **20
characters**. `good exp` is 8, so `canGenerate` was false in AI mode.

After repair, the same input enables Generate, keeps the text intact, sends the
request, and shows an actionable result.

---

## 2. Exact root cause

| Layer | File / expression | Problem |
|---|---|---|
| Client gate | `src/components/review/review-assistant.tsx` — `AI_MIN_FEEDBACK_CHARS = 20` | 8-character genuine input blocked |
| Client button | `canGenerate = mode === 'ai' ? aiGated : …` | Disabled without exact requirement |
| Card API | `src/app/api/public/reviews/[alias]/generate/route.ts` — `feedback.min(20)` | Would reject the same input |
| Standee API | `src/app/api/public/standee-reviews/[slug]/generate/route.ts` — `feedback.min(20)` | Same rejection |
| Hint copy | “A little more detail…” | Did not state the minimum or how much more was needed |
| Secondary | `handleChangeLength()` force-refreshed templates (`forceTemplate`) | Selecting Short in AI mode silently switched the customer back to template mode |

No feature-flag, entitlement, provider or Review Management defect caused the
disabled state. The provider was not contacted because the client never sent the
request.

---

## 3. Changes made

1. **Minimum input lowered from 20 to 3 characters** in the client and both
   generate APIs. `good exp` is accepted; empty, whitespace-only and 1–2
   character inputs are still rejected.
2. **Exact validation copy**:
   - Empty: “Write at least 3 characters about your experience to generate a review.”
   - Short: “Add N more character(s) to generate a review — or continue with your own words.”
   - Server: “Add at least 3 characters about your experience.”
3. **Visible disabled-state explanation** under Generate Review (`role="status"`),
   not only a passive hint.
4. **AI mode is preserved when changing draft length.** Template refresh only
   runs in template mode. Selecting Short in AI mode no longer resets the mode.
5. **API schema aligned** for Card and Standee.
6. Analytics invalid-input test updated from 5-character `'short'` to
   1-character `'a'`, because short genuine input is now valid by design.

### Button states

| State | Behaviour |
|---|---|
| Ready | Generate enabled; selected language/length sent |
| Generating | Button shows “Working…”; duplicate clicks blocked |
| More information | Disabled with exact remaining-character message |
| AI unavailable | Enabled request returns actionable message; manual path remains |
| Rate limit | Explicit 429/limit message |
| Generation failed | Error shown, input preserved, retry possible |
| Feature disabled | Page/entitlement gate unchanged (no bypass) |

---

## 4. Files changed

- `src/components/review/review-assistant.tsx` — 3-char gate, exact hints,
  visible status, AI-mode length preservation.
- `src/app/api/public/reviews/[alias]/generate/route.ts` — min 3.
- `src/app/api/public/standee-reviews/[slug]/generate/route.ts` — min 3.
- `scripts/test-review-analytics.ts` — invalid-input fixture + short/Hindi
  provider-prompt assertions.
- `docs/PHASE_4D10_GATE_P2_6_PUBLIC_AI_REVIEW_FIX.md` — this report.

No schema, data, alias, NFC/QR URL, Google destination, entitlement or flag change.

---

## 5. Validation and button-state correction

- `"good exp"`: accepted; Generate enabled; request sent; input retained.
- `"ab"`: disabled with “Add 1 more character…”; existing input retained.
- `""` / whitespace: disabled with the exact 3-character requirement.
- `"a"`: API 400 with “Add at least 3 characters about your experience.”
- Generating: no duplicate submission; UI shows Working.
- AI unavailable: explicit message, button re-enabled, manual “Use my words as
  my review” still available.

---

## 6. Review Management integration

Unchanged and still authoritative:

- Public page resolves the exact Card, entitlement and effective settings
  (legacy/central/hybrid, with the public central gate).
- Language list, preferred length, style, category and topics come from the
  effective settings.
- Explicitly disabled reviews still cannot generate.
- Lower-tier Cards remain restricted.
- No flag was activated and no entitlement was bypassed.

---

## 7. AI provider test results

| Test | Result |
|---|---|
| Mocked provider success (English) | PASS |
| Short genuine input `good exp` reaches provider prompt | PASS |
| Hindi language and Hindi input reach provider prompt | PASS |
| Provider returns Hindi draft | PASS |
| Empty provider response → `UNAVAILABLE`, no fabricated draft | PASS |
| Provider throw/timeout → `UNAVAILABLE` | PASS |
| Card API with valid short input reaches service | 503 `UNAVAILABLE` when no tenant key — **not 400** |
| Card API with 1-char input | 400 validation |
| Live OpenAI call | **NOT TESTED** (no authorized non-production credentials) |

No fake AI response was used to claim live provider success.

---

## 8. English / Hindi results

- English: `good exp` prompt includes the customer text, `English`, and `short`.
- Hindi: language and Devanagari input are forwarded; mocked Hindi output is
  returned unchanged and remains editable.
- No English-only assumption was found in the generation path.
- Templates remain category-scoped; no cross-category substitution was added.

---

## 9. Review quality / factuality

The system prompt remains authoritative: rewrite only supplied details, never
invent businesses, staff, prices, ratings or experiences; do not add sentiment
the customer did not express; no star rating; no auto-posting. Short input may
produce a modest draft, but the customer can edit/copy manually and nothing is
published automatically.

---

## 10. Backward compatibility

- No existing review URL, NFC/QR route, Google destination, alias, UID or
  Standee route changed.
- No ReviewSettings/template/analytics/rotation/customer record changed.
- Existing 20+ character flows still work.
- Both Card and Standee APIs changed only their minimum validation (more
  permissive; no client contract break).
- P2.3 unified Review Management, P2.4 preview routing and P2.5 dev/prod build
  isolation remain intact.

---

## 11. Regression results

| Suite | Result |
|---|---|
| Typecheck / ESLint | PASS |
| Build OFF / ON | PASS |
| 4D.5 Review Management | 57/57 OFF · 57/57 ON |
| 4D.6 Standee | 20/20 × 4 = 80/80 |
| Unified analytics (incl. short + Hindi) | 9/9 |
| Historical analytics | 9/9 |
| 16-combination matrix | 192/192 |
| 4D.8/4D.9 fixes | 0 failures; 14/14 rows |
| Builder tabs / preview resolver | 9/9 · 13/13 |
| Security / entitlement | PASS · 130/130 |
| Review Library / import | 48/48 · 13/13 |
| Card / dynamic / Standee lifecycle | 49/49 · 29/29 · 24/24 |
| VCF / QR PDF | 69/69 · PASS |
| `git diff --check` | clean |

Browser verification: 320/1440; `good exp` + Short selected, Generate enabled,
request sent, actionable unavailable message, input retained, manual path
visible. `ab` disabled with the exact remaining-character message. No overflow.

---

## 12. Remaining configuration requirements

- A valid per-tenant OpenAI key/config must exist for live generation. Without
  it the API correctly returns `UNAVAILABLE`; the UI now explains this instead
  of leaving a dead disabled button.
- Live provider, Preview and Production verification remain pending.
- Provider timeout/rate-limit behavior is covered by mocked tests only.

---

## 13. Preview verification instructions

1. Deploy/refresh the approved Preview build (owner approval required).
2. Open a review-enabled Card with AI configured.
3. Choose “Write it with AI instead”, enter `good exp`, select English + Short.
4. Confirm Generate is enabled, the exact hint is correct, and the request is
   sent.
5. With a valid non-production key, confirm an editable draft appears and
   matches the input without invented facts.
6. Repeat with Hindi text/language; confirm Devanagari output.
7. Test `ab` (disabled + exact message), empty, and a 500-character input.
8. Force a provider failure; confirm the actionable message and manual path.
9. Confirm copy and Google handoff work; no auto-post.
10. Verify lower-tier Cards remain denied and existing public URLs unchanged.

---

## 14. Rollback

Revert the three source files and the test-fixture change. No database rollback
is required. Restore the 20-character minimum only if the product decision
changes; doing so will re-disable `good exp`. No customer data or public route
needs restoration.

**LOCAL AI REVIEW REPAIR COMPLETE — PREVIEW VERIFICATION REQUIRED**

Stopped. No commit, push, deployment, remote database access or flag activation
occurred.
