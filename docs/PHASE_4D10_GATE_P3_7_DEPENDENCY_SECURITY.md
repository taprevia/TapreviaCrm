# TAPREVIA — PHASE 4D.10 GATE P3.7
# DEPENDENCY SECURITY

**Scope:** read-only offline review. No dependency was upgraded, installed or
removed.

## 1. Inventory

| Metric | Value |
|---|---:|
| Direct production dependencies | 20 |
| Direct development dependencies | 13 |
| Packages in `package-lock.json` | 619 |
| `npm ls --depth=0` | clean |
| `npm audit --offline` | 0 info/low/moderate/high/critical |

Key runtime versions: Next.js 14.2.35, React 18, Mongoose 8.16.x, Zod 4.4.3,
`jose` 6, `jsonwebtoken` 9, `sharp` 0.35.3, `@aws-sdk/*`, `resend`, `qrcode`,
`papaparse`.

## 2. Online advisory status

**NOT VERIFIED.** Online advisory databases require registry network access,
which this gate prohibits. `npm audit --offline` reports zero, but an empty or
stale offline advisory cache is not authoritative.

No network-enabled `npm audit` was run.

## 3. Approved future read-only audit

Run outside the application runtime, with no production credentials:

```bash
npm audit --json
npm audit --omit=dev --json
npx osv-scanner --lockfile=package-lock.json   # only if approved/installed
```

Then triage any advisory by package, installed version, advisory ID, severity,
range, direct/transitive status, whether the vulnerable path is used, and
breaking-change risk.

## 4. Confirmed advisories

**0 confirmed** in the offline data available. This is not a claim that the
dependency tree is currently free of advisories.

## 5. Proposed upgrades

**None applied or proposed without an approved advisory.** No dependency
upgrade is required by this gate’s verified findings.

## 6. Compatibility risk

Any future upgrade must preserve Next 14.2 build behavior, React 18, Mongoose
schema behavior, and the Vercel runtime. No lockfile change was made.

**P3.7 INCOMPLETE — REQUIRED VERIFICATION GAPS REMAIN**

