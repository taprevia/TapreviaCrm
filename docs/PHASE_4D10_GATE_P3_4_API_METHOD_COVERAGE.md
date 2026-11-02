# TAPREVIA — P3.4 API METHOD COVERAGE

**Status:** P3.4 INCOMPLETE — API OR UI COVERAGE GAPS REMAIN

## Inventory

| Verb | Methods |
|---|---|
| GET | 43 |
| POST | 29 |
| PATCH | 13 |
| PUT | 6 |
| DELETE | 8 |
| **Total** | **99** |

79 route files. Inventory generated from current `src/app/api/**/route.ts`.

## Execution evidence

### Route-level unauthenticated/invalid execution

All **99/99 methods** were invoked against the real local Next.js route handlers with
unauthenticated or empty/invalid request bodies (appropriate for auth/validation
negative testing), using synthetic route identifiers.

| Status | Count |
|---|---|
| 200 | 6 |
| 400 | 13 |
| 401 | 75 |
| 403 | 2 |
| 404 | 3 |
| 5xx / network failure | **0** |

No unexpected 5xx or unclassified status occurred. This proves route-level
handler execution, not full positive authorization/validation coverage.

### Authorized GET execution

All **43/43 GET methods** were invoked with an admin or customer session:

| Status | Count |
|---|---|
| 200 | 37 |
| 400 expected validation | 4 |
| 404 expected missing/unsupported fixture | 2 |
| 5xx | **0** |

Expected 400s: analytics missing card/standee; my/qr missing slug; appointment
slots missing date; review preview missing assignmentId. Expected 404s: public
Card/VCF for a review-only alias fixture.

## Coverage by verb

| Verb | Methods executed at least one route-level scenario | Full positive + negative matrix |
|---|---|---|
| GET | 43/43 | 43 authorized GET + 43 unauthenticated/invalid |
| POST | 29/29 executed unauth/invalid | Positive authorized POST scenarios: subset |
| PATCH | 13/13 executed unauth/invalid | Positive authorized PATCH scenarios: subset |
| PUT | 6/6 executed unauth/invalid | Positive authorized PUT scenarios: subset |
| DELETE | 8/8 executed unauth/invalid | Positive authorized DELETE scenarios: subset |

## Not tested

- Positive authorized success and side-effect assertions for every POST/PATCH/PUT/
  DELETE method.
- Wrong-role and wrong-tenant rejection for every method.
- Duplicate/stale/concurrent request behavior for every method.
- Malformed identifier/body matrix for every method.
- External-provider failure behavior per method (where applicable).

## Verdict

99/99 methods were executed at least once through the real route handlers with
no 5xx. This is **not** a full 99-method positive/negative API certification, so
the API coverage goal is not complete.

**P3.4 INCOMPLETE — API OR UI COVERAGE GAPS REMAIN**

## Method inventory

| # | Method | Route |
|---|---|---|
| 1 | GET | `/api/admin/card-templates` |
| 2 | PUT | `/api/admin/card-templates` |
| 3 | GET | `/api/admin/catalog` |
| 4 | POST | `/api/admin/catalog` |
| 5 | GET | `/api/admin/export` |
| 6 | GET | `/api/admin/overview` |
| 7 | DELETE | `/api/admin/review-library/categories/[key]` |
| 8 | GET | `/api/admin/review-library/export` |
| 9 | POST | `/api/admin/review-library/import/preview` |
| 10 | POST | `/api/admin/review-library/import` |
| 11 | GET | `/api/admin/review-library` |
| 12 | POST | `/api/admin/review-library` |
| 13 | DELETE | `/api/admin/review-library/templates/[key]` |
| 14 | GET | `/api/admin/standee-qr` |
| 15 | DELETE | `/api/admin/standee-qr` |
| 16 | PATCH | `/api/admin/templates/[id]` |
| 17 | PUT | `/api/admin/users/[id]/products/[userProductId]/card` |
| 18 | GET | `/api/admin/users/[id]/products` |
| 19 | POST | `/api/admin/users/[id]/products` |
| 20 | DELETE | `/api/admin/users/[id]/products` |
| 21 | POST | `/api/admin/users/[id]/reset-password` |
| 22 | GET | `/api/admin/users/[id]` |
| 23 | PATCH | `/api/admin/users/[id]` |
| 24 | PUT | `/api/admin/users/[id]` |
| 25 | POST | `/api/admin/users/[id]/standy` |
| 26 | DELETE | `/api/admin/users/[id]/standy` |
| 27 | PUT | `/api/admin/users/[id]/templates` |
| 28 | GET | `/api/admin/users` |
| 29 | POST | `/api/admin/users` |
| 30 | GET | `/api/analytics` |
| 31 | PATCH | `/api/appointments/[id]` |
| 32 | GET | `/api/appointments` |
| 33 | POST | `/api/auth/forgot-password` |
| 34 | POST | `/api/auth/login` |
| 35 | POST | `/api/auth/logout` |
| 36 | GET | `/api/auth/me` |
| 37 | POST | `/api/auth/register` |
| 38 | POST | `/api/auth/reset-password` |
| 39 | GET | `/api/card-templates` |
| 40 | GET | `/api/cards/[id]/products` |
| 41 | POST | `/api/cards/[id]/products` |
| 42 | GET | `/api/cards/[id]/review-entitlement` |
| 43 | GET | `/api/cards/[id]` |
| 44 | PATCH | `/api/cards/[id]` |
| 45 | DELETE | `/api/cards/[id]` |
| 46 | GET | `/api/cards/check-alias` |
| 47 | GET | `/api/cards` |
| 48 | POST | `/api/cards` |
| 49 | PATCH | `/api/customer/settings` |
| 50 | GET | `/api/health` |
| 51 | PATCH | `/api/inquiries/[id]` |
| 52 | GET | `/api/inquiries/export` |
| 53 | GET | `/api/inquiries` |
| 54 | GET | `/api/my/capabilities` |
| 55 | GET | `/api/my/features` |
| 56 | PATCH | `/api/my/products/[id]/config` |
| 57 | GET | `/api/my/products/[id]` |
| 58 | PATCH | `/api/my/products/[id]` |
| 59 | GET | `/api/my/products` |
| 60 | GET | `/api/my/qr` |
| 61 | GET | `/api/newsletter-subscribers/export` |
| 62 | GET | `/api/newsletter-subscribers` |
| 63 | PATCH | `/api/product-enquiries/[id]` |
| 64 | GET | `/api/product-enquiries` |
| 65 | PATCH | `/api/products/[id]` |
| 66 | DELETE | `/api/products/[id]` |
| 67 | PUT | `/api/profile/change-password` |
| 68 | PUT | `/api/profile/social-links` |
| 69 | POST | `/api/public/cards/[alias]/appointments` |
| 70 | GET | `/api/public/cards/[alias]/appointments/slots` |
| 71 | POST | `/api/public/cards/[alias]/inquiries` |
| 72 | POST | `/api/public/cards/[alias]/newsletter` |
| 73 | POST | `/api/public/cards/[alias]/product-enquiries` |
| 74 | GET | `/api/public/cards/[alias]` |
| 75 | GET | `/api/public/cards/[alias]/vcf` |
| 76 | GET | `/api/public/review-categories` |
| 77 | GET | `/api/public/review-languages` |
| 78 | POST | `/api/public/reviews/[alias]/copied` |
| 79 | POST | `/api/public/reviews/[alias]/generate` |
| 80 | POST | `/api/public/reviews/[alias]/suggestions` |
| 81 | POST | `/api/public/standee-reviews/[slug]/copied` |
| 82 | POST | `/api/public/standee-reviews/[slug]/generate` |
| 83 | POST | `/api/public/standee-reviews/[slug]/suggestions` |
| 84 | POST | `/api/public/track` |
| 85 | GET | `/api/review-management/analytics` |
| 86 | GET | `/api/review-management/options` |
| 87 | GET | `/api/review-management/preview` |
| 88 | PATCH | `/api/review-management/products/[assignmentId]` |
| 89 | GET | `/api/review-management/products` |
| 90 | GET | `/api/review-management` |
| 91 | PATCH | `/api/review-management` |
| 92 | GET | `/api/settings` |
| 93 | PATCH | `/api/settings` |
| 94 | GET | `/api/standees` |
| 95 | POST | `/api/uploads/confirm` |
| 96 | POST | `/api/uploads/presign` |
| 97 | POST | `/api/uploads` |
| 98 | GET | `/api/uploads` |
| 99 | DELETE | `/api/uploads` |
