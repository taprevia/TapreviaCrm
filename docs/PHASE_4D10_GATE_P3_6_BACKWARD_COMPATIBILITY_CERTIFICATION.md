# TAPREVIA — PHASE 4D.10 GATE P3.6
# BACKWARD-COMPATIBILITY CERTIFICATION

**Branch:** `Devlopment` · **HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Final status:** **P3.6 QUALITY AUDIT COMPLETE — VERIFIED RISKS REMAIN**
**Backward compatibility:** **PASSED**

## 1. Checks before and after repair

| Check | Before | After |
|---|---|---|
| P3.5 write API harness | 56/56, 210 scenarios | **56/56, 210 scenarios** |
| P3.5 UI workflow harness | 29/29, 1,321 controls | **29/29, 1,321 controls, 0 overflow** |
| P2.7 BC central OFF | 11/11 | **11/11** |
| P2.7 BC central ON | 11/11 | **11/11** |
| P2.8 URL resolver | 15/15 | **15/15** |
| TypeScript / ESLint / build | PASS | **PASS** |
| `git diff --check` | clean | **clean** |

No unexpected collection mutation was reported by the BC snapshots; identifiers
and destinations remained unchanged.

## 2. Preserved contracts

- Customer accounts, roles, status.
- Product assignments, quantities and entitlements.
- Card IDs/UIDs, `slug`, `routeSlug`, `uid`, `urlAlias`, `publicSlug`.
- Standee IDs, `routeSlug`, `uid`, panel/social QR IDs.
- Printed `/r/...` NFC/QR routes and `/c`, `/profile`, `/review`, `/panel`
  canonical routes.
- Google/social destinations (only explicit test edits changed them).
- ReviewSettings central/individual/hybrid readers; legacy `reviewAssistant`.
- Review Library, rotation history, analytics history.
- Feature-flag defaults and all 16 flag combinations.
- VCF, QR PDF, legacy API contracts.

## 3. Intentional behaviour change

`P36-D04` changes API requests carrying an **invalid session cookie** from a
307 HTML redirect to a 401 JSON response. Valid sessions, page redirects, and
all successful API contracts are unchanged. This is a deliberate correction of
an incorrect content type for API clients; no valid customer flow depended on
the redirect. Regression checks pass.

## 4. Repairs and compatibility risk

All other repairs are presentation-only (semantic HTML, labels, contrast,
responsive classes). They do not alter routes, identifiers, data, API schemas,
flags or entitlements.

## 5. Conclusion

Backward compatibility passed in the executed local scope. Existing customers
do not need to reconfigure products. No destructive migration was introduced.

**BACKWARD COMPATIBILITY: PASSED**
