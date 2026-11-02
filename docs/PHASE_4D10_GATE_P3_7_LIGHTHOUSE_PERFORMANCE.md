# TAPREVIA — PHASE 4D.10 GATE P3.7
# LIGHTHOUSE & PERFORMANCE

## 1. Lighthouse status

**BLOCKED — NOT VERIFIED.**

- `lighthouse` is not installed and is not in the npm cache.
- `npx --offline lighthouse --version` fails with `ENOTCACHED`.
- Installing it requires public registry access, which this gate prohibits.
- No Lighthouse score is reported or invented.

## 2. Local field-style metrics (CDP, production build)

Environment: 390×844, DPR 2, 4× CPU, 150 ms RTT / 1.6 Mbps down / 750 kbps up,
cache disabled, 2 runs per page, external requests blocked.

Stable second run:

| Page | LCP ms | CLS | TBT ms |
|---|---:|---:|---:|
| Landing | 962 | 0.03 | 58 |
| Login | 840 | 0 | 0 |
| Dashboard | 1,152 | 0 | 0 |
| My Products | 1,134 | 0 | 0 |
| Admin Dashboard | 1,122 | 0 | 0 |
| Admin User Details | 2,218 | 0 | 0 |
| Review Management | 2,516 | 0 | 0 |
| Public Review | 828 | 0.09 | 0 |
| Standee | 1,136 | 0 | 0 |
| Public Profile | 850 | 0 | 5.5 |

A first warm-up run showed local variance (LCP up to 2.87 s,
p95 API up to 227 ms); the second run is reported as the stable sample.

## 3. API latency (second run, 20 samples)

| Endpoint | Median ms | p95 ms |
|---|---:|---:|
| health | 1.9 | 53.9 |
| auth/me | 1.8 | 4.6 |
| my/products | 5.0 | 11.9 |
| cards | 7.5 | 36.3 |
| review-management | 6.6 | 14.8 |
| analytics | 10.6 | 61.3 |
| public card | 2.9 | 4.9 |
| review suggestions | 8.0 | 13.3 |
| admin/users | 3.6 | 9.9 |
| admin/users/[id] | 8.0 | 12.4 |

Errors: **0/200**.

## 4. Bundle and memory

- Bundle: **1,220,628 B raw / 381,241 B gzip** (unchanged by P3.7).
- Server RSS delta after 200 requests: **−27,600 KB** (GC reclaimed; no growth
  signal in this bounded run).

## 5. Findings

- LCP is under 2.6 s in the stable run; CLS ≤0.09.
- No confirmed performance defect met the evidence threshold.
- Real INP, Lighthouse scores, production CDN/cache behavior and field data are
  **NOT VERIFIED**.
- Font remediation (P37 font report) would also remove two blocked external
  requests and may improve first render.

**P3.7 INCOMPLETE — REQUIRED VERIFICATION GAPS REMAIN**

