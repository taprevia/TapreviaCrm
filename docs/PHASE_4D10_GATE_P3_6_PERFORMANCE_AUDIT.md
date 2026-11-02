# TAPREVIA — PHASE 4D.10 GATE P3.6
# PERFORMANCE AUDIT

**Execution:** local production build (`next start`) · local MongoDB
**Lighthouse:** **NOT VERIFIED** — Lighthouse is not installed or cached locally;
installing it would require network/package changes outside this gate.
Field-style metrics below were collected with Chrome DevTools Protocol.

## 1. Environment

- Viewport 390×844, DPR 2, mobile.
- CPU throttle 4×; network 150 ms RTT, 1.6 Mbps down, 750 kbps up; cache disabled.
- 2 runs per page; median reported.
- External requests blocked (no live services).

## 2. Page metrics (median of 2)

| Page | FCP ms | LCP ms | CLS | TBT ms | Load ms | Transfer B |
|---|---:|---:|---:|---:|---:|---:|
| Landing | 824 | 824 | 0.03 | 49.5 | 1,964 | 619,531 |
| Login | 842 | 842 | 0 | 0 | 2,007 | 246,422 |
| Dashboard | 822 | 1,138 | 0 | 0 | 1,734 | 247,185 |
| My Products | 804 | 1,118 | 0 | 0 | 1,718 | 247,185 |
| Admin Dashboard | 822 | 1,120 | 0 | 0 | 1,715 | 247,185 |
| Admin User Details | 832 | 2,204 | 0 | 0 | 1,864 | 258,021 |
| Review Management | 812 | 2,522 | 0 | 0 | 1,808 | 247,485 |
| Public Review | 816 | 816 | 0.09 | 0 | 1,916 | 289,384 |
| Standee | 814 | 1,130 | 0 | 0 | 1,731 | 247,709 |
| Public Profile | 832 | 832 | 0 | 0 | 1,998 | 278,342 |

All measured LCP values are ≤2.52 s and CLS ≤0.09 under this synthetic profile.
INP was not measured (NOT VERIFIED).

## 3. API latency (20 samples each)

| Endpoint | Median ms | p95 ms | Errors |
|---|---:|---:|---:|
| /api/health | 1.8 | 31.3 | 0 |
| /api/auth/me | 2.0 | 4.1 | 0 |
| /api/my/products | 6.0 | 12.7 | 0 |
| /api/cards | 6.0 | 36.0 | 0 |
| /api/review-management | 4.0 | 6.0 | 0 |
| /api/analytics | 5.7 | 14.2 | 0 |
| /api/public/cards/[alias] | 3.5 | 4.7 | 0 |
| /api/public/reviews/[alias]/suggestions | 8.1 | 15.8 | 0 |
| /api/admin/users | 3.4 | 9.5 | 0 |
| /api/admin/users/[id] | 9.8 | 15.9 | 0 |

Error rate: **0/200**. Local synthetic results are not production SLAs.

## 4. Bundle

- 26 client JS chunks; **1,220,628 B raw / 381,241 B gzip** total.
- Largest chunks: 172,837 B (53,744 gzip), 156,890 B (51,232 gzip),
  140,001 B (44,962 gzip).
- No dependency was removed; no package changes were made.

## 5. Database performance

Explain plans after index sync, with 5,000 synthetic analytics logs and 1,000
inquiries:

| Query | ms | Docs examined | Index |
|---|---:|---:|---|
| card by urlAlias | 1 | 1 | `urlAlias_1` |
| user by email | 0 | 1 | `email_1` |
| analytics by card + timestamp | 0 | 50 | `cardId_1_timestamp_-1` |
| inquiries by user + createdAt | 0 | 50 | `userId_1_createdAt_-1` |
| assignments by user + status | 0 | 7 | `userId_1_status_1` |
| templates by category + active | 0 | 1 | `categoryKey_1_active_1_language_1` |
| standee by routeSlug | 0 | 1 | `routeSlug_1` |

No collection scan was observed in these representative queries.

## 6. Memory and assets

- Server RSS: 207,568 KB before → 213,152 KB after 200 health requests
  (+5,584 KB). Bounded burst; no uncontrolled load test.
- Two external Google Fonts stylesheet requests were attempted by the landing
  page and blocked. This is an external dependency/privacy and caching
  consideration; no runtime failure occurred because fallback fonts render.

## 7. Findings

- No confirmed performance defect met the evidence threshold.
- Lighthouse scores, real INP, production CDN/cache behavior, and real-user
  field data are **NOT VERIFIED**.
- Recommendation (needs owner decision, not applied): self-host the Inter font
  to remove the external font request.

**P3.6 QUALITY AUDIT COMPLETE — VERIFIED RISKS REMAIN**

