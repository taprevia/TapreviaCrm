# Taprevia CRM - Complete Codebase Abnormalities Report

**Scan Date:** 2025-10-24  
**Scope:** Full codebase under `/Users/prince/Documents/CRM`  
**Stack:** Next.js 14.2.35 (App Router), TypeScript (strict), Mongoose 8, MongoDB, Resend, OpenAI, Cloudflare R2  
**Method:** Systematic file-by-file review of critical paths (auth, middleware, API routes, models, validation, crypto, storage, config). No files modified during scan.  

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Critical Findings](#critical-findings)
3. [High Findings](#high-findings)
4. [Medium Findings](#medium-findings)
5. [Low Findings](#low-findings)
6. [Verified Safe Areas](#verified-safe-areas)
7. [Observations / Minor Issues](#observations--minor-issues)
8. [Hygiene Notes](#hygiene-notes)
9. [Remediation Priority](#remediation-priority)

---

## Executive Summary

This is a large, mature codebase with good security practices in many areas (authz checks on most routes, Zod validation, CSRF middleware, proper secret handling in many places). However, there are several critical issues, particularly around XSS, data leakage in public APIs/HTML, and some configuration issues.

| Severity | Count | Primary Themes |
|----------|-------|----------------|
| CRITICAL | 4 | Stored XSS, public data leakage (API + HTML/RSC), unprotected rich HTML fields |
| HIGH | 4 | URL scheme injection, CSV formula injection, public exposure of suspended/unpublished cards, missing security hardening on some paths |
| MEDIUM | 8 | Rate limiting gaps, PII retention, crypto key handling, VCF leaks, tracking, identifier leakage |
| LOW | 7 | Prompt injection, missing validations, dead code, minor header/escaping issues |

---

## Critical Findings

### C1: Stored XSS via un-sanitized `descriptionHtml` (and related rich HTML)
- **Severity:** CRITICAL | Unauthenticated victims | Persistent | Survives CSP (`'unsafe-inline'`)
- **Locations:**
  - Validation: `src/lib/validation/card.ts:163` - `descriptionHtml: z.string().max(20000).optional()` (length only, no sanitization)
  - API persistence: `src/app/api/cards/[id]/route.ts:177-199` - verbatim assignment, no transform
  - Sinks (all use `dangerouslySetInnerHTML`):
    - `src/components/public/templates/professional-profile.tsx:159,772` 
    - `src/components/public/templates/panthi-event.tsx:618,1033`
    - `src/components/public/templates/social.tsx:56,109`
- **Evidence:** No `dompurify`/`sanitize-html` in `package.json` dependencies or codebase. Comments in code claim sanitization but it's not implemented.
- **Impact:** Arbitrary JS execution on every visitor to affected public card pages. Can exfiltrate cookies/tokens, perform actions as victim, inject phishing content.
- **Notes:** `privacyPolicyHtml`/`termsHtml` (validation `card.ts:185-186`, persistence `api/cards/[id]/route.ts:191-192`) are also length-only and unsanitized with no current sinks but represent latent XSS vectors.

### C2: Public Card API returns entire unprojected Card document
- **Severity:** CRITICAL | Unauthenticated | Information disclosure
- **Locations:**
  - `src/app/api/public/cards/[alias]/route.ts:14-183` - `return ok({ card: card.toObject(), products });` with full document
  - `src/lib/services/card-access.ts:68-71` - `Card.findOne({...})` with no `.select()` projection
- **Leaked fields (confirmed):** `userId`, `assignedUserId`, `cardUid`, `previousCardUids[]`, `basic.dateOfBirth` (writable, never rendered), `basic.alternateEmail`, `linkedinConfig.resumeUrl`, `reviewAssistant.employees[]`, `reviewAssistant.services[]`, `reviewAssistant.keywords[]`, `reviewAssistant.category`, `stats.taps`, `totalTaps`, `socialLinks[].clicks`, `_id`, `__v`, `routeSlug`, `slug`, `publicSlug`, `status`, `setupComplete`, `location.lat/lng`, `whatsappConfig`, `facebookConfig`, etc.
- **Impact:** Exposes internal identifiers (including userId needed for targeting other endpoints), physical NFC serials, PII not intended for public display.

### C3: Full Card document embedded in HTML/RSC flight payload
- **Severity:** CRITICAL | View Source accessible | Survives C2 fix
- **Locations:**
  - `src/app/profile/[alias]/page.tsx:34-43` - passes full card object across `'use client'` boundary
  - `src/components/public/public-card-page.tsx:128-133`
  - `src/components/public/template-registry.tsx:40-41`
  - All public templates are client components: `professional-profile.tsx:1`, `panthi-event.tsx:1`, `social.tsx:1`, `sticky-dock.tsx:1` 
- **Evidence:** Build artifacts contain full card JSON in HTML. Everything else not needed by client is leaked.
- **Impact:** Permanent, cacheable disclosure via View Source, proxies, browser extensions, archiving services.

### C4: `.env.example` ignored by gitignore
- **Severity:** CRITICAL (operational/security hygiene) | May prevent proper env setup
- **Location:** `.gitignore:47` contains `.env*` with no negation for `.env.example`
- **Evidence:** `.env.example` exists but is gitignored; `README.md` documents env setup expecting it. If untracked/ignored in some contexts, it won't be committed - but the file exists. However the pattern `!.env.example` is missing.
- **Impact:** New developers may not get the template; also means if someone expects it to be tracked, it won't be. Also documents `APP_KEY` requirement which is important.

---

## High Findings

### H1: `javascript:` URL injection via duplicated product-config schema
- **Severity:** HIGH | Authenticated writer | Dashboard
- **Locations:**
  - `src/lib/validation/product-config.ts:120-131` - `linkedin.profileUrl`/`resumeUrl` and `facebook.*` defined as plain `z.string()` without scheme validation (strict schemas exist at `:63,70`)
  - `src/app/api/my/products/[id]/config/route.ts:132-151` - assigns to config and sets `card.redirectUrl`
  - Sink: `src/app/(dashboard)/dashboard/products/page.tsx:132,135,141,407-409` renders as `<a href={destination.href} target="_blank" rel="noreferrer">`
- **Exploit:** Authenticated user can persist `javascript:` URLs; clicking in dashboard executes with session.
- **Note:** Public redirects use `isSafeExternalUrl` gating.

### H2: Suspended/unpublished cards remain public
- **Severity:** HIGH | Defeats admin controls
- **Locations:**
  - `src/lib/services/card-access.ts:68-71` - only checks `isActive: true` (missing `status: 'active'` and user status checks)
  - `src/app/api/admin/users/[id]/route.ts:180-185` - suspending user sets `Card.status: 'suspended'` but leaves `isActive: true`
  - `src/app/api/cards/route.ts:99-107` - creates cards with `isActive: true`, `status: 'unassigned'` (immediately public)
- **Contrast:** `getPublicCardByOwnerBizSlug` correctly checks `User.status === 'active'` - asymmetry.
- **Impact:** Suspended tenants' cards fully public with PII.

### H3: CSV formula injection (3 export endpoints)
- **Severity:** HIGH | Unauthenticated input → privileged execution
- **Endpoints:**
  - `src/app/api/inquiries/export/route.ts:105` - `Papa.unparse` without `escapeFormulae`
  - `src/app/api/admin/export/route.ts:91` - same
  - `src/app/api/newsletter-subscribers/export/route.ts:70` - same
- **Vectors:** Inquiry fields accept arbitrary chars (`src/lib/validation/inquiry.ts:17-33`); email regex (`src/lib/validation/common.ts:46`) allows `=`/`+`/`-` in local part.
- **Impact:** Formulas execute when CSV opened in Excel/Sheets/LibreOffice (HYPERLINK, potential DDE).

### H4: Missing `noopener noreferrer` in some dashboard links
- **Severity:** HIGH | Tabnabbing
- **Location:** `src/app/(dashboard)/dashboard/products/page.tsx:408` uses `rel="noreferrer"` but missing `noopener`. Also other places may vary.
- **Impact:** New tab can access `window.opener`.

---

## Medium Findings

### M1: NFC/tap tracking abuse - no dedup, 200 on limit, unbounded writes
- **Severity:** MEDIUM | Cost + metric integrity
- **Locations:** `src/app/api/public/track/route.ts:37-39,69-79`
- **Issues:**
  1. Rate limit returns `ok({skipped:true})` with status 200 when over limit (no backpressure)
  2. `tap` action does unconditional `$inc` on `Card.stats.taps` with no deduplication
  3. Creates `AnalyticsLog` per allowed request
  4. Per-IP only, proxyable; no tenant/global caps
  5. Over-limit still costs serverless invocations + limiter queries
- **Impact:** Tap count inflation, cost amplification.

### M2: Rate limiter fails open
- **Severity:** MEDIUM | Availability vs security trade-off
- **Location:** `src/lib/rate-limit.ts:9-10,47-51,77-81` - on DB connect/query errors returns success
- **Impact:** MongoDB outage disables all rate limits (auth, OpenAI, reviews). Spend-bearing routes vulnerable during outages.

### M3: Plaintext IP + full User-Agent retained
- **Severity:** MEDIUM | Privacy/GDPR
- **Locations:** `src/models/AnalyticsLog.ts:28-30,39` - stores raw IP, full UA; TTL 180 days. Written from ~10 call sites.
- **Impact:** Long retention of identifying/fingerprinting data.

### M4: JWT_SECRET reused as AES key fallback in non-prod; prod now fails fast
- **Severity:** MEDIUM | Key separation
- **Location:** `src/lib/crypto.ts:39-59` - non-prod falls back to `sha256(JWT_SECRET)`. Prod throws if APP_KEY missing (good). But same secret class used for signing and encryption is weak.
- **Impact:** If APP_KEY missing historically or misconfigured, keys coupled; rotation issues.

### M5: VCF over-disclosure
- **Severity:** MEDIUM | Durable exfiltration
- **Locations:** `src/lib/vcf.ts:98,107-110` - embeds `cardUid` in UID, includes alternatePhone/alternateEmail. Gates default off but UI doesn't expose toggle; `config.displayAddToContact` not enforced server-side.
- **Impact:** NFC serial persists in synced contacts; alternate contacts shared.

### M6: `coverValue` unvalidated (tracking pixel)
- **Severity:** MEDIUM | Privacy
- **Locations:** `src/lib/validation/card.ts:170` no URL validation; `src/components/public/templates/social.tsx:79-81` falsely claims sanitization. Loaded as `<img src={coverValue}>`.
- **Impact:** Visitor IP/UA/referrer leakage on every view (no JS execution).

### M7: Appointment POST echoes owner `userId`
- **Severity:** MEDIUM | Identifier oracle
- **Location:** `src/app/api/public/cards/[alias]/appointments/route.ts:83` returns full appointment document including owner `userId`.
- **Impact:** Harvestable identifier.

### M8: Media driver configuration risk
- **Severity:** MEDIUM | Deployment
- **Locations:** `src/lib/storage/index.ts:57` defaults to `'s3'` in production; `src/lib/storage/s3.ts:18` requires `S3_BUCKET`. If env vars missing, uploads will fail at runtime.
- **Impact:** Deployment misconfiguration breaks media uploads.

---

## Low Findings

### L1: OpenAI prompt injection (bounded)
- **Severity:** LOW | Bounded impact
- **Location:** `src/lib/services/review-generate.ts:164-173` - raw feedback/topics/language interpolated into prompt
- **Notes:** No tools, output rendered as React children only, spend controlled. Still worth hardening with structured output.

### L2: `privacyPolicyHtml`/`termsHtml` unsanitized (latent)
- **Severity:** LOW | Latent XSS
- **Locations:** `src/lib/validation/card.ts:185-186`, `src/app/api/cards/[id]/route.ts:191-192` - length only, no sanitization, no current sinks.

### L3: Forgot-password spend/enumeration
- **Severity:** LOW | Cost
- **Location:** `src/app/api/auth/forgot-password/route.ts:12-14` - has limits but could be tighter; enumeration correctly prevented.

### L4: Missing ObjectId validation in admin route
- **Severity:** LOW | Error handling
- **Location:** `src/app/api/admin/standee-qr/route.ts:57,62` - `standeeId` not validated with zod; may throw 500.

### L5: JSON-LD via dangerouslySetInnerHTML without escaping
- **Severity:** LOW | Fragile
- **Location:** `src/app/(public)/page.tsx:91,95` - `JSON.stringify` not escaped for `</script>`; hardcoded now but risky if dynamic.

### L6: Dead code with raw hrefs
- **Severity:** LOW | Maintenance/security debt
- **Locations:** `src/components/public/socials-row.tsx`, `src/components/public/track-link.tsx` - no importers, render raw `href={link.url}`.

### L7: Some links missing noopener
- **Severity:** LOW | Tabnabbing
- **Various locations** - mostly using `noreferrer` or `noopener noreferrer` in most places, but need to audit all `target="_blank"`.

---

## Verified Safe Areas

- **Authorization/IDOR:** All 68 non-public/non-auth routes use `requireAuth`/`requireAdmin`/`requireAdminStrict`/capability checks. Ownership consistently enforced. No exploitable IDOR/BOLA found.
- **Passwords:** `getAuthUser` selects `-passwordHash`, builds minimal `AuthUser`. No route returns password hashes.
- **CSRF:** `src/middleware.ts:34-97` enforces same-origin for cookie-authenticated mutations.
- **Security headers:** `next.config.mjs:30-58` sets CSP, HSTS (prod), nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options DENY, frame-ancestors none, object-src none, base-uri self, form-action self.
- **Injection:** No `eval/new Function/child_process/spawn/vm`. Zod validation before DB operations. ObjectId params validated where used. ReDoS avoided via input escaping.
- **VCF safety:** Proper escaping per RFC 6350, filename sanitization, nosniff, no-store cache.
- **Redirects:** `/r/[...slug]`, `/qr/[id]` gated through `isSafeExternalUrl` with projections.
- **Uploads:** Server-generated keys, MIME/size checks, ownership validation, confirm re-validates via HEAD, strict key grammar, traversal guards.
- **Rate limiting:** Broadly present on auth/public endpoints. OpenAI spend well-controlled (per-tenant daily reservation, no prompt logging).
- **Secrets:** No credentials in tracked files. `.env.local` gitignored. AES-GCM implementation correct. Prod fails fast if `APP_KEY` missing.
- **Analytics read:** Aggregation only, properly gated, PII not selected.
- **Middleware:** Proper route whitelisting, auth checks, role checks, CSRF protection.

---

## Observations / Minor Issues

- **TypeScript strict mode enabled** - good practice
- **Comprehensive validation with Zod v4** - good
- **Mongoose models use proper indexing** - good (TTL indexes present)
- **Error handling generally consistent** with `ok()`/`fail()` helpers
- **Build artifacts present** (`.next/`) - normal for repo state
- **Large node_modules** - expected
- **Many test scripts in `/scripts/`** - good for verification

---

## Hygiene Notes

1. **`.gitignore` missing negation for `.env.example`** - Add `!.env.example` after `.env*` rule so the template is tracked.
2. **Media driver config** - Ensure `MEDIA_DRIVER=s3` with proper `S3_*`/`AWS_*` vars in production, or set to `local` appropriately.
3. **APP_KEY rotation** - Documented in code; if ever used with fallback, rotation needs re-encryption.
4. **Dead code cleanup** - `socials-row.tsx`, `track-link.tsx` unused.

---

## Remediation Priority

| Priority | Items | Effort | Notes |
|----------|-------|--------|-------|
| P0 (Immediate) | C1 (XSS), C2, C3 | M-L | Actively exploitable; fix before any public exposure |
| P1 (High) | H1, H2, H3, H4 | S-M | High impact, relatively straightforward fixes |
| P2 (Medium) | M1-M8 | M | Important hardening, some require design decisions |
| P3 (Low) | L1-L7 | S | Good practice improvements |

**Key recommendation:** Prioritize C1 (add HTML sanitization with allowlist), C2/C3 (implement strict DTOs/projections), H2 (fix public access gates), H3 (add CSV formula escaping). These address the most severe issues.

---

*Report generated by comprehensive static analysis. No application files were modified during this scan.*
