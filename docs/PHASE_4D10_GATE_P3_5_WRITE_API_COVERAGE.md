# TAPREVIA — PHASE 4D.10 GATE P3.5
# WRITE API COVERAGE

**Branch:** `Devlopment`
**HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Execution:** local Next.js build + local MongoDB (`taprevia_p35_audit`)
**Final status:** **P3.5 LOCAL COVERAGE COMPLETE — BACKWARD COMPATIBILITY PASSED**

## 1. Reconciled inventory

Re-scanned `src/app/api/**/route.ts` from the current tree.

| Verb | Methods |
|---|---|
| GET | 43 |
| POST | 29 |
| PATCH | 13 |
| PUT | 6 |
| DELETE | 8 |
| **Total** | **99** |
| **Writable (POST/PATCH/PUT/DELETE)** | **56** |

The P3.4 baseline of 56 write methods is unchanged. All 56 were executed
against real route handlers in the running local application.

## 2. Execution result

| Metric | Count |
|---|---|
| Write methods discovered | **56** |
| Write methods tested | **56** |
| Write methods passed | **56** |
| Write methods failed | **0** |
| Write methods blocked | **0** |
| Write methods not tested | **0** |
| Scenarios executed | **210** |
| Positive scenarios | **68** |
| Negative scenarios | **84** |
| Security scenarios | **58** |
| Standalone DB snapshot checks | **2 / 2 passed** |
| In-scenario MongoDB re-read checks | **45 / 45 passed** |
| Confirmed API defects | **0** |

Every write method passed at least one positive (or intentional-gate) case and
at least one negative/security case where applicable. The two intentional
non-mutating contracts are recorded explicitly:

- `POST /api/admin/catalog` is disabled by design and always returns 403 while
  making no catalog write.
- `POST /api/admin/review-library/import/preview` performs read-only analysis;
  the harness verified no category/template was created.

## 3. Scenario classes

### Positive
Authorized requests with synthetic fixtures; response status/shape asserted and
MongoDB re-read to confirm persistence (45 scenarios executed a query inside the
post-request verification step, all passed; plus two standalone snapshot checks).

### Negative
Missing/invalid input, malformed ObjectIds, nonexistent resources, duplicate
keys, illegal state transitions, stale revisions, oversized/invalid payloads,
and intentional feature-disabled operations.

### Security
- Every protected write route without a session → 401.
- Every admin write route with a customer session → 403.
- Cross-tenant mutation attempts on appointments, inquiries, product enquiries,
  cards, products, uploads, and review management → 403/404 with no mutation.
- Uploaded media ownership and review-settings prototype-pollution payloads
  rejected.

## 4. Concurrency / idempotency

| Scenario | Result |
|---|---|
| Concurrent `PATCH /api/review-management` with the same revision | one 200, one 409 |
| Concurrent appointment booking for the same slot | one 201, one 409 |
| Duplicate review-copy `copyId` | 200 `duplicate:true`, single event |
| Repeated `DELETE` | intended 404, no extra mutation |

## 5. Destructive operation safety

All 8 DELETE methods were exercised only against disposable synthetic records.
Repeat requests were checked (404 after deletion), and cascade behavior was
verified for standee, user-product, card, product, and upload deletion. No
customer or remote record was touched.

## 6. Method inventory

Access column describes the authentication/authorization gate actually observed.
“+” / “−” / “Sec” are executed scenario counts. DB side effect is the primary
persisted mutation asserted for the positive case.

| ID | Method | Route | Access | + | − | Sec | DB side effect | Result |
|---|---|---|---|---|---|---|---|---|
| W01 | PUT | `/api/admin/card-templates` | Admin JWT | 1 | 0 | 2 | SystemSettings.cardTemplateNames | PASS |
| W02 | POST | `/api/admin/catalog` | Admin JWT | 1 | 0 | 0 | None — intentionally disabled | PASS |
| W03 | DELETE | `/api/admin/review-library/categories/[key]` | Admin JWT | 1 | 2 | 2 | ReviewCategory delete (+ cascade templates) | PASS |
| W04 | POST | `/api/admin/review-library/import/preview` | Admin JWT | 1 | 1 | 2 | None — read-only analysis | PASS |
| W05 | POST | `/api/admin/review-library/import` | Admin JWT | 2 | 1 | 2 | ReviewCategory/Template upsert | PASS |
| W06 | POST | `/api/admin/review-library` | Admin JWT | 2 | 2 | 2 | ReviewCategory/Template create | PASS |
| W07 | DELETE | `/api/admin/review-library/templates/[key]` | Admin JWT | 1 | 1 | 2 | ReviewTemplate delete | PASS |
| W08 | DELETE | `/api/admin/standee-qr` | Admin JWT | 1 | 1 | 2 | Standee delete + UserProduct removed | PASS |
| W09 | PATCH | `/api/admin/templates/[id]` | Admin JWT | 1 | 2 | 2 | SystemSettings.cardTemplateNames | PASS |
| W10 | PUT | `/api/admin/users/[id]/products/[userProductId]/card` | Admin JWT | 1 | 1 | 2 | Card.cardUid + previousCardUids | PASS |
| W11 | POST | `/api/admin/users/[id]/products` | Admin JWT | 1 | 3 | 2 | Card + UserProduct create | PASS |
| W12 | DELETE | `/api/admin/users/[id]/products` | Admin JWT | 1 | 1 | 2 | UserProduct → removed | PASS |
| W13 | POST | `/api/admin/users/[id]/reset-password` | Admin JWT | 1 | 2 | 2 | User.passwordHash | PASS |
| W14 | PATCH | `/api/admin/users/[id]` | Admin JWT | 1 | 2 | 2 | User name/email/phone | PASS |
| W15 | PUT | `/api/admin/users/[id]` | Admin JWT | 3 | 1 | 2 | User.status / delete cascade | PASS |
| W16 | POST | `/api/admin/users/[id]/standy` | Admin JWT | 1 | 2 | 2 | Standee + UserProduct create | PASS |
| W17 | DELETE | `/api/admin/users/[id]/standy` | Admin JWT | 1 | 1 | 2 | Standee + assignment delete | PASS |
| W18 | PUT | `/api/admin/users/[id]/templates` | Admin JWT | 1 | 1 | 2 | Profile.allowedTemplates | PASS |
| W19 | POST | `/api/admin/users` | Admin JWT | 1 | 2 | 2 | User + Profile + Card + UserProduct | PASS |
| W20 | PATCH | `/api/appointments/[id]` | Customer + appointments | 1 | 3 | 1 | Appointment.status | PASS |
| W21 | POST | `/api/auth/forgot-password` | Public / auth | 2 | 1 | 0 | PasswordResetToken + console mail | PASS |
| W22 | POST | `/api/auth/login` | Public / auth | 1 | 3 | 1 | None (session only) | PASS |
| W23 | POST | `/api/auth/logout` | Public / auth | 1 | 0 | 0 | Auth cookie cleared | PASS |
| W24 | POST | `/api/auth/register` | Public / auth | 1 | 2 | 0 | User + Profile create | PASS |
| W25 | POST | `/api/auth/reset-password` | Public / auth | 1 | 1 | 0 | Reset token consumed + password | PASS |
| W26 | POST | `/api/cards/[id]/products` | Customer + vCards entitlement | 1 | 2 | 1 | Product create | PASS |
| W27 | PATCH | `/api/cards/[id]` | Customer + vCards entitlement | 1 | 3 | 1 | Card fields | PASS |
| W28 | DELETE | `/api/cards/[id]` | Customer + vCards entitlement | 2 | 2 | 1 | Card delete | PASS |
| W29 | POST | `/api/cards` | Customer + vCards entitlement | 1 | 1 | 1 | Card create | PASS |
| W30 | PATCH | `/api/customer/settings` | Customer session | 1 | 1 | 1 | User.isNewsletterEnabled | PASS |
| W31 | PATCH | `/api/inquiries/[id]` | Customer + lead_capture | 1 | 2 | 1 | Inquiry.status + notes | PASS |
| W32 | PATCH | `/api/my/products/[id]/config` | Customer session (+ cap) | 2 | 2 | 1 | Card.redirectUrl / reviewAssistant | PASS |
| W33 | PATCH | `/api/my/products/[id]` | Customer session (+ cap) | 1 | 1 | 1 | Card.cardLabel / Standee.displayName + log | PASS |
| W34 | PATCH | `/api/product-enquiries/[id]` | Customer + catalogue | 1 | 2 | 1 | ProductEnquiry.status | PASS |
| W35 | PATCH | `/api/products/[id]` | Customer + profile_edit | 1 | 2 | 1 | Product fields | PASS |
| W36 | DELETE | `/api/products/[id]` | Customer + profile_edit | 1 | 1 | 1 | Product delete + media cleanup | PASS |
| W37 | PUT | `/api/profile/change-password` | Customer session | 2 | 1 | 1 | User.passwordHash | PASS |
| W38 | PUT | `/api/profile/social-links` | Customer session | 1 | 2 | 1 | Profile.socialLinks | PASS |
| W39 | POST | `/api/public/cards/[alias]/appointments` | Public (rate-limited) | 2 | 3 | 0 | Appointment create | PASS |
| W40 | POST | `/api/public/cards/[alias]/inquiries` | Public (rate-limited) | 1 | 2 | 0 | Inquiry + AnalyticsLog | PASS |
| W41 | POST | `/api/public/cards/[alias]/newsletter` | Public (rate-limited) | 2 | 1 | 0 | NewsletterSubscriber | PASS |
| W42 | POST | `/api/public/cards/[alias]/product-enquiries` | Public (rate-limited) | 1 | 1 | 0 | ProductEnquiry + Product.enquiryCount + log | PASS |
| W43 | POST | `/api/public/reviews/[alias]/copied` | Public (rate-limited) | 2 | 1 | 0 | ReviewRotationEvent | PASS |
| W44 | POST | `/api/public/reviews/[alias]/generate` | Public (rate-limited) | 1 | 1 | 0 | None — AI unconfigured 503 | PASS |
| W45 | POST | `/api/public/reviews/[alias]/suggestions` | Public (rate-limited) | 1 | 1 | 0 | AnalyticsLog review_suggestions_shown | PASS |
| W46 | POST | `/api/public/standee-reviews/[slug]/copied` | Public (rate-limited) | 1 | 1 | 0 | ReviewRotationEvent (standee) | PASS |
| W47 | POST | `/api/public/standee-reviews/[slug]/generate` | Public (rate-limited) | 1 | 1 | 0 | None — AI unconfigured 503 | PASS |
| W48 | POST | `/api/public/standee-reviews/[slug]/suggestions` | Public (rate-limited) | 1 | 1 | 0 | AnalyticsLog | PASS |
| W49 | POST | `/api/public/track` | Public (rate-limited) | 1 | 1 | 0 | Card.stats.taps + AnalyticsLog | PASS |
| W50 | PATCH | `/api/review-management/products/[assignmentId]` | Customer + review entitlement | 1 | 2 | 1 | Card review source/overrides | PASS |
| W51 | PATCH | `/api/review-management` | Customer + review entitlement | 2 | 3 | 1 | ReviewSettings | PASS |
| W52 | PATCH | `/api/settings` | Customer session | 1 | 1 | 1 | TenantSettings | PASS |
| W53 | POST | `/api/uploads/confirm` | Customer + profile_edit | 1 | 2 | 1 | Media → ready | PASS |
| W54 | POST | `/api/uploads/presign` | Customer + profile_edit | 1 | 1 | 1 | None — local proxy mode | PASS |
| W55 | POST | `/api/uploads` | Customer + profile_edit | 1 | 1 | 1 | Media + local file | PASS |
| W56 | DELETE | `/api/uploads` | Customer + profile_edit | 1 | 2 | 1 | Media + local file delete | PASS |

## 7. Exclusions

- Live AI provider calls: blocked; the AI path was verified only for its
  unconfigured-provider 503 contract.
- Real email/SMS/WhatsApp/payment/Google delivery: not executed; reserved
  `example.test` destinations were used.
- OS-level egress firewall: not available in this environment.
