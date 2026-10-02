/**
 * Entitlement-driven dashboard verification (config + source level).
 *
 * Proves the PRODUCT → CAPABILITIES → DASHBOARD NAVIGATION → PAGE/API
 * AUTHORIZATION chain end-to-end at build time (no DB required):
 *
 *   1. Nav config integrity — every entitlement-relevant CUSTOMER_NAV_ITEMS
 *      row declares a capability; only platform universals stay null.
 *   2. Capability registry sanity — every gated nav capability exists in the
 *      registry and is granted by at least one catalog product (no orphan
 *      nav items no product can ever reveal).
 *   3. Page-guard parity — every gated nav route has a server page wrapper
 *      calling requirePageCapability with the SAME capability.
 *   4. API-guard parity — every entitlement-bound API route calls
 *      requireApiEntitlement with the SAME capability.
 *   5. Product → nav matrix — for every catalog product, filterNavByCapabilities
 *      reveals exactly the items it deserves; a single-platform customer
 *      (LinkedIn-only …) sees exactly its own product row and the universals
 *      — never an unrelated platform — and a multi-platform customer sees each
 *      applicable row exactly once. (Account is a separate shell-managed route.)
 *   6. Canonical manage routing — resolveProductManageHref resolves the SAME
 *      destination across every entry point: instantiated card → specific card
 *      editor, standee with configured slots → slot manager, assignment without
 *      an instantiated card → assignment config page, and never another
 *      product's instance.
 *   7. Instagram config surface — the products/[id] Instagram section is gated
 *      by the ASSIGNED PRODUCT slug (insta-card), never by existing config,
 *      and the brand-aware placeholder resolves "insta" (and "instagram") to
 *      the Instagram sample URL. Public routing (redirectUrl) and the config
 *      API guards are pinned unchanged.
 *   8. P3 copy/config surface — NFC plate vs NFC card wording, "Setup
 *      Required" casing, product-specific social destination copy, the Google
 *      Review single-source-of-truth (redirectUrl scoped to social cards, no
 *      forced reviewAssistant.enabled), and standee single-GET displayName
 *      parity with the list API.
 *   9. P4 uninstantiated assignment configuration — pendingConfig schema on
 *      UserProduct, card-less assignment creation, config PATCH pending branch
 *      (card + standee), GET single-product instance synthesis, admin card
 *      linking, and capability gate parity with bound assignments.
 *
 * Run with: npm run test:entitlement
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  ALL_PRODUCT_IDS,
  getProductCapabilities,
  PRODUCT_CATALOG,
} from '@/config/products';
import { CAPABILITY_DEFS, isCapabilityId, ANALYTICS_CAPABILITIES, type CapabilityId } from '@/config/capabilities';
import {
  CUSTOMER_NAV_ITEMS,
  filterNavByCapabilities,
  dedupeNavByDestination,
  type NavItem,
} from '@/config/dashboard-navigation';
import { resolveProductManageHref } from '@/lib/product-route';
import {
  standeeConfigured,
  standeeConfiguredSlotCount,
  standeeNeedsSetup,
  unboundCardNeedsSetup,
} from '@/lib/product-status';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

const ROOT = path.resolve(__dirname, '..');

/** Server page wrapper for a dashboard nav href (route group + /dashboard). */
const pageForHref = (href: string): string =>
  path.join(ROOT, 'src', 'app', '(dashboard)', href.replace(/^\//, ''), 'page.tsx');

/** API route file for a route path under /api (may use [id] segments). */
const apiFileForPath = (apiPath: string): string =>
  path.join(ROOT, 'src', 'app', 'api', apiPath.replace(/^\//, ''), 'route.ts');

function hasText(file: string, needle: string): boolean {
  return readFileSync(file, 'utf8').includes(needle);
}

function main(): void {
  console.log('\n1) NAV CONFIG INTEGRITY');
  console.log('──');

  // Only these three rows are platform-universal; anything else MUST be gated.
  const UNIVERSAL_LABELS = ['Dashboard', 'My Products', 'Settings'];
  const gated = CUSTOMER_NAV_ITEMS.filter((item) => item.requiredCapability !== null);
  const universals = CUSTOMER_NAV_ITEMS.filter((item) => item.requiredCapability === null);

  check(
    'Every entitlement-relevant nav row declares a capability',
    gated.every((item) => item.requiredCapability !== null)
  );
  check(
    'Only platform universals stay null',
    universals.every((item) => UNIVERSAL_LABELS.includes(item.label))
  );
  check(
    'All three platform universals present',
    UNIVERSAL_LABELS.every((label) =>
      CUSTOMER_NAV_ITEMS.some((item) => item.label === label && item.requiredCapability === null)
    )
  );
  const gatedCaps = gated
    .map((item) => item.requiredCapability as CapabilityId)
    .concat(gated.flatMap((item) => item.anyCapability ?? []));
  check(
    'Every gated capability exists in the registry',
    gatedCaps.every((cap) => isCapabilityId(cap) && Boolean(CAPABILITY_DEFS[cap])),
    gatedCaps.filter((cap) => !isCapabilityId(cap) || !CAPABILITY_DEFS[cap])
  );

  console.log('\n2) CAPABILITY REGISTRY & ORPHAN CHECK');
  console.log('──');

  const allProductCaps = new Set<CapabilityId>();
  for (const id of ALL_PRODUCT_IDS) {
    for (const cap of getProductCapabilities(id)) {
      allProductCaps.add(cap);
    }
  }
  check(
    'Catalog coverage — every gated nav capability is granted by ≥1 product',
    gatedCaps.every((cap) => allProductCaps.has(cap)),
    [...new Set(gatedCaps)].filter((cap) => !allProductCaps.has(cap))
  );

  console.log('\n3) PAGE-GUARD PARITY (nav ↔ server page wrapper)');
  console.log('──');

  for (const item of gated) {
    const file = pageForHref(item.href);
    const exists = existsSync(file);
    // P8-B — Analytics unlocks for ANY of the analytics capabilities, so its
    // wrapper uses requireAnyPageCapability with the shared capability set.
    const isAnalytics = item.href === '/dashboard/analytics';
    check(
      `Page guard present for ${item.href} (${item.requiredCapability})`,
      exists
        ? isAnalytics
          ? hasText(file, `requireAnyPageCapability([...ANALYTICS_CAPABILITIES]`)
          : hasText(file, `requirePageCapability('${item.requiredCapability}'`)
        : false,
      exists ? undefined : 'missing page.tsx'
    );
  }
  check(
    'Universal pages need no guard (products, products/[id], settings, account)',
    [
      '/dashboard/products',
      '/dashboard/settings',
      '/dashboard/account',
    ].every((href) => existsSync(pageForHref(href)))
  );

  console.log('\n4) API-GUARD PARITY (entitled endpoints ↔ capability)');
  console.log('──');

  const API_GUARDS: Array<[string, CapabilityId]> = [
    ['/appointments', 'appointments'],
    ['/appointments/[id]', 'appointments'],
    ['/inquiries', 'lead_capture'],
    ['/inquiries/[id]', 'lead_capture'],
    ['/inquiries/export', 'lead_capture'],
    ['/product-enquiries', 'catalogue'],
    ['/product-enquiries/[id]', 'catalogue'],
    ['/newsletter-subscribers', 'lead_capture'],
    ['/newsletter-subscribers/export', 'lead_capture'],
    ['/cards', 'profile_edit'],
    ['/cards/[id]', 'profile_edit'],
    ['/cards/[id]/products', 'profile_edit'],
    ['/card-templates', 'profile_edit'],
    ['/uploads', 'profile_edit'],
    ['/products/[id]', 'profile_edit'],
  ];

  for (const [apiPath, capability] of API_GUARDS) {
    const file = apiFileForPath(apiPath);
    const exists = existsSync(file);
    check(
      `API guard present for ${apiPath} (${capability})`,
      exists && hasText(file, `requireApiEntitlement(request, '${capability}'`),
      exists ? undefined : 'missing route.ts'
    );
  }

  // P8-B — /api/analytics gates on ANY analytics capability (cards + standees),
  // and the shared capability set is exactly the card/standee analytics set.
  const analyticsApi = apiFileForPath('/analytics');
  check(
    'P8-B: API guard for /analytics uses the any-analytics capability set',
    existsSync(analyticsApi) &&
      hasText(analyticsApi, `requireAnyApiCapability(request, [...ANALYTICS_CAPABILITIES]`)
  );
  check(
    'P8-B: analytics capability set is exactly card + standee analytics',
    JSON.stringify([...ANALYTICS_CAPABILITIES]) ===
      JSON.stringify(['dynamic_dashboard', 'tap_analytics', 'standee_analytics'])
  );
  check(
    'P8-B: /api/cards stays vCard-profile gated (profile_edit)',
    hasText(apiFileForPath('/cards'), `requireApiEntitlement(request, 'profile_edit'`)
  );

  console.log('\n5) PRODUCT → NAV MATRIX');
  console.log('──');

  const labelOf = (items: NavItem[]) => items.map((i) => i.label);

  for (const productId of ALL_PRODUCT_IDS) {
    const caps = getProductCapabilities(productId);
    const visible = filterNavByCapabilities(CUSTOMER_NAV_ITEMS, caps);
    const visibleGated = visible.filter((item) => item.requiredCapability !== null);

    // A gate can only be credited to a capability the product actually grants.
    const unjustified = visibleGated.filter((item) => {
      const hasSingle = item.requiredCapability !== null && caps.includes(item.requiredCapability);
      const hasAny = item.anyCapability?.some((c) => caps.includes(c)) ?? false;
      return !hasSingle && !hasAny;
    });

    check(
      `${PRODUCT_CATALOG[productId].name}: nav reveals only entitled items`,
      unjustified.length === 0,
      unjustified.map((i) => i.label)
    );
  }

  // ── Single-platform & multi-platform acceptance matrix ─────────────────────
  const linkedInCaps = getProductCapabilities('LINKEDIN_CARD');
  const instagramCaps = getProductCapabilities('INSTA_CARD');
  const googleReviewCaps = getProductCapabilities('GOOGLE_REVIEW_CARD');
  const facebookCaps = getProductCapabilities('FACEBOOK_CARD');
  // No single-platform WhatsApp product exists; WhatsApp is granted by package
  // products (e.g. ALL_IN_ONE_STANDEE_4), so a hypothetical WhatsApp-only
  // customer resolves to this capability set. The nav result is what matters.
  const whatsappOnlyCaps: CapabilityId[] = [
    'qr', 'nfc', 'whatsapp', 'dynamic_link', 'multi_language', 'tap_analytics',
  ];

  const expectNav = (name: string, caps: CapabilityId[], expected: string[]) => {
    const actual = labelOf(filterNavByCapabilities(CUSTOMER_NAV_ITEMS, caps));
    check(
      `${name} nav set`,
      actual.join('|') === expected.join('|'),
      { actual, expected }
    );
  };

  check(
    'LinkedIn-only grant excludes dynamic_dashboard (no Analytics)',
    !linkedInCaps.includes('dynamic_dashboard')
  );
  check(
    'LinkedIn-only grant excludes lead_capture (no Subscribers)',
    !linkedInCaps.includes('lead_capture')
  );

  expectNav('LinkedIn-only (acceptance target)', linkedInCaps, ['Dashboard', 'My Products', 'LinkedIn', 'Settings', 'Analytics']);
  expectNav('Instagram-only', instagramCaps, ['Dashboard', 'My Products', 'Instagram', 'Settings', 'Analytics']);
  expectNav('Google Review-only', googleReviewCaps, ['Dashboard', 'My Products', 'Google Reviews', 'Settings', 'Analytics']);
  expectNav('Facebook-only', facebookCaps, ['Dashboard', 'My Products', 'Facebook', 'Settings', 'Analytics']);
  expectNav('WhatsApp-only', whatsappOnlyCaps, ['Dashboard', 'My Products', 'WhatsApp', 'Settings', 'Analytics']);
  expectNav('No capability (universals only)', [], ['Dashboard', 'My Products', 'Settings']);
  expectNav(
    'LinkedIn + Instagram (multi, each row once)',
    [...new Set([...linkedInCaps, ...instagramCaps])],
    ['Dashboard', 'My Products', 'LinkedIn', 'Instagram', 'Settings', 'Analytics']
  );

  // P8-B — every catalog product grants an analytics capability (cards →
  // tap_analytics, standees → standee_analytics, premium cards →
  // dynamic_dashboard), so every single-platform set now surfaces the shared
  // Analytics row. Only a capability set WITHOUT an analytics capability must
  // keep it hidden (never grant analytics by accident).
  const platformSets = [linkedInCaps, instagramCaps, googleReviewCaps, facebookCaps, whatsappOnlyCaps];
  check(
    'P8-B: every single-platform product set sees its own Analytics row',
    platformSets.every((caps) => labelOf(filterNavByCapabilities(CUSTOMER_NAV_ITEMS, caps)).includes('Analytics'))
  );
  check(
    'P8-B: a capability set without an analytics capability still hides Analytics',
    !labelOf(filterNavByCapabilities(CUSTOMER_NAV_ITEMS, ['qr', 'nfc'])).includes('Analytics')
  );

  // Each product-specific row is registered exactly once (no duplicate rows).
  const productLabels = ['LinkedIn', 'Instagram', 'Google Reviews', 'Facebook', 'WhatsApp'];
  const dupes = productLabels.filter(
    (label) => CUSTOMER_NAV_ITEMS.filter((i) => i.label === label).length !== 1
  );
  check('Product-specific rows registered exactly once', dupes.length === 0, dupes);

  const businessCaps = getProductCapabilities('BUSINESS_NFC_CARD');
  const businessNav = labelOf(filterNavByCapabilities(CUSTOMER_NAV_ITEMS, businessCaps));
  check(
    'Business card sees Analytics + Subscribers + vCards',
    ['Analytics', 'Subscribers', 'vCards'].every((l) => businessNav.includes(l))
  );
  check(
    'Business card does not see single-platform rows',
    !productLabels.some((l) => businessNav.includes(l))
  );

  console.log('\n6) CANONICAL MANAGE ROUTING (resolveProductManageHref)');
  console.log('──');

  check(
    'Instantiated card → its specific card editor',
    resolveProductManageHref({ assignmentId: 'asg-1', instanceType: 'card', instance: { id: 'card-9' } }) ===
      '/dashboard/vcards/card-9/edit'
  );
  check(
    'Card id whitespace is trimmed for the editor href',
    resolveProductManageHref({ assignmentId: 'asg-1', instanceType: 'card', instance: { id: '  card-9  ' } }) ===
      '/dashboard/vcards/card-9/edit'
  );
  check(
    'Card instance without id → assignment config page (never a broken editor)',
    resolveProductManageHref({ assignmentId: 'asg-1', instanceType: 'card', instance: { id: '' } }) ===
      '/dashboard/products/asg-1'
  );
  check(
    'Standee with configured slots → slot manager',
    resolveProductManageHref({
      assignmentId: 'asg-2',
      instanceType: 'standee',
      instance: { id: 's-1', socialQrs: [{ qrId: 'q1', platform: 'instagram' }] },
    }) === '/dashboard/standees'
  );
  check(
    'Standee without configured slots → assignment config page',
    resolveProductManageHref({ assignmentId: 'asg-2', instanceType: 'standee', instance: { id: 's-1', socialQrs: [] } }) ===
      '/dashboard/products/asg-2'
  );
  check(
    'Assignment without an instance → assignment config page',
    resolveProductManageHref({ assignmentId: 'asg-3', instanceType: null, instance: null }) ===
      '/dashboard/products/asg-3'
  );
  check(
    'Missing assignment id → universal My Products fallback',
    resolveProductManageHref({ assignmentId: '', instanceType: 'standee', instance: { id: 's-1', socialQrs: [] } }) ===
      '/dashboard/products'
  );
  check(
    'No product at all → universal My Products fallback',
    resolveProductManageHref({}) === '/dashboard/products'
  );
  const first = resolveProductManageHref({ assignmentId: 'asg-a', instanceType: 'card', instance: { id: 'card-a' } });
  const second = resolveProductManageHref({ assignmentId: 'asg-b', instanceType: 'card', instance: { id: 'card-b' } });
  check(
    'Never routes a product to another product\u2019s instance',
    first === '/dashboard/vcards/card-a/edit' && second === '/dashboard/vcards/card-b/edit'
  );

  // P8-A — the overview Quick Actions card must route its per-product manage
  // action through the SAME canonical resolver (never a stale pre-P2-A href).
  const quickActionsCard = path.join(
    ROOT,
    'src',
    'components',
    'dashboard',
    'overview',
    'quick-actions.tsx'
  );
  check(
    'P8-A: QuickActionsCard uses the canonical resolver for its card action',
    existsSync(quickActionsCard) &&
      hasText(quickActionsCard, 'resolveProductManageHref') &&
      hasText(quickActionsCard, "from '@/lib/product-route'")
  );

  console.log('\n7) INSTAGRAM CONFIG SURFACE (products/[id] gate + placeholder)');
  console.log('──');

  const productPage = pageForHref('/dashboard/products/[id]');
  const publicCardPage = path.join(ROOT, 'src', 'components', 'public', 'public-card-page.tsx');
  const configRoute = apiFileForPath('/my/products/[id]/config');

  check(
    'Instagram section gated by product identity (isInstagramProduct), not existing config',
    hasText(productPage, '{isInstagramProduct && (') &&
      !hasText(productPage, '{data.instance?.instagramConfig?.profileUrl && (')
  );
  check(
    'isInstagramProduct matches ONLY insta/instagram slugs — never linkedin/facebook',
    hasText(productPage, `['insta', 'instagram'].includes(`) &&
      hasText(productPage, `(data?.catalogProduct?.slug ?? '').split('-')[0]`)
  );
  check(
    'Existing Instagram config still renders (form seeded from instagramConfig)',
    hasText(productPage, `inst?.instagramConfig?.username ?? ''`) &&
      hasText(productPage, `inst?.instagramConfig?.profileUrl ?? ''`)
  );
  check(
    'Instagram save path preserved — body.instagram via existing PATCH config endpoint',
    hasText(productPage, 'body.instagram = {') &&
      hasText(productPage, '/api/my/products/${params.id}/config`')
  );
  check(
    'SOCIAL_PLACEHOLDERS maps insta-card slug (insta) + instagram → https://instagram.com/yourpage',
    hasText(productPage, "insta: 'https://instagram.com/yourpage'") &&
      hasText(productPage, "instagram: 'https://instagram.com/yourpage'")
  );
  check(
    'LinkedIn/Facebook placeholders remain distinct (no cross-brand sample URLs)',
    hasText(productPage, "linkedin: 'https://linkedin.com/in/yourname'") &&
      hasText(productPage, "facebook: 'https://facebook.com/yourpage'")
  );
  check(
    'Deliberate fallback placeholder kept for unknown social slugs',
    hasText(productPage, "'https://yourlink.com/destination'")
  );
  check(
    'Public Instagram behavior untouched — public-card-page routes via redirectUrl and never reads instagramConfig',
    hasText(publicCardPage, "card.redirectUrl?.trim()") &&
      !hasText(publicCardPage, 'instagramConfig')
  );
  check(
    'Config API guards unchanged — requireAuth + ownership + hasCapability (kind-based)',
    hasText(configRoute, 'requireAuth(request)') &&
      hasText(configRoute, 'userId: user._id') &&
      hasText(configRoute, 'hasCapability(user._id')
  );

  console.log('\n8) P3 PRODUCT COPY, REVIEW CONFIG & STANDEE PARITY');
  console.log('──');

  const productsListPage = pageForHref('/dashboard/products');
  const myProductsCard = path.join(ROOT, 'src', 'components', 'dashboard', 'overview', 'my-products.tsx');
  const standeeManager = path.join(ROOT, 'src', 'components', 'dashboard', 'standee-manager.tsx');
  const productDetailRoute = apiFileForPath('/my/products/[id]');

  // P3-1 — Google Review plate must not read "NFC card".
  check(
    'Products detail subtitle distinguishes NFC plate from NFC card (code-level category)',
    hasText(productPage, 'isPlate = data?.productDef?.category === \'plate\'') &&
      hasText(productPage, 'NFC plate')
  );
  check(
    'My Products list knows NFC Plate category',
    hasText(productsListPage, "plate: { label: 'NFC Plate', icon: Tag }") &&
      hasText(productsListPage, "product.productDef?.category ?? product.catalogProduct?.category")
  );

  // P3-2 — "Setup Required" casing standardized across product/setup UI.
  check(
    'Standee manager setup text uses title case',
    hasText(standeeManager, 'Setup Required') && !hasText(standeeManager, 'setup required')
  );
  check(
    'Dashboard overview setup text uses title case',
    hasText(myProductsCard, 'Setup Required') && !hasText(myProductsCard, 'Setup required')
  );

  // P3-3 — product-specific social destination copy.
  check(
    'Social destination copy is product-specific (Instagram/LinkedIn/Facebook) with deliberate fallback',
    hasText(productPage, 'Instagram destination') &&
      hasText(productPage, 'LinkedIn destination') &&
      hasText(productPage, 'Facebook destination') &&
      hasText(productPage, "?? 'free destination link'")
  );

  // P3-4 — one authoritative source of truth for Google Review config.
  check(
    'redirectUrl coercion scoped to social cards only (never clobbers review/profile)',
    hasText(configRoute, "if (kind === 'social' && card.instagramConfig.profileUrl)") &&
      !hasText(configRoute, 'if (card.instagramConfig.profileUrl) {')
  );
  check(
    'Review assistant enabled state NOT force-written by legacy dashboard save',
    !hasText(configRoute, 'card.reviewAssistant.enabled = true;') &&
      hasText(configRoute, 'enabled: true,')
  );
  check(
    'Google Review URL writes to the single authoritative field (reviewAssistant.googleReviewUrl)',
    hasText(configRoute, 'card.reviewAssistant.googleReviewUrl = data.googleReview.googleReviewUrl;')
  );

  // P3-5 — standee response shape parity between list and single-product GET.
  check(
    'Single-product GET selects displayName like the list API (standee round-trip parity)',
    hasText(productDetailRoute, "'name displayName routeSlug productKey") &&
      hasText(productDetailRoute, 'displayName: instance.displayName')
  );

  // ── 9. P4 UNINSTANTIATED ASSIGNMENT CONFIGURATION ──────────────────────────
  console.log('\n9) UNINSTANTIATED ASSIGNMENT CONFIGURATION');
  console.log('──');

  const userProductModel = path.join(ROOT, 'src', 'models', 'UserProduct.ts');
  const assignmentService = path.join(
    ROOT,
    'src',
    'lib',
    'services',
    'user-product-assignment.ts'
  );
  // config route and product detail already loaded above as configRoute / productDetailRoute

  // P4-1 — UserProduct schema exposes a pendingConfig field for uninstantiated
  // assignments (card-shaped, single authoritative source).
  check(
    'UserProduct schema declares pendingConfig subdocument',
    hasText(userProductModel, 'pendingConfig') &&
      hasText(userProductModel, 'PendingConfigSchema') &&
      hasText(userProductModel, 'default: null')
  );

  // P4-2 — assignUserProduct supports card-less assignment (no longer rejects
  // when cardUid is missing; creates an assignment without a physical card).
  check(
    'assignUserProduct supports card-less assignments (no hard UID requirement)',
    hasText(assignmentService, 'Card-less assignment') &&
      hasText(assignmentService, 'pendingConfig') &&
      !hasText(assignmentService, "return { ok: false, status: 400, error: 'Card UID is required")
  );

  // P4-3 — config PATCH persists to pendingConfig for uninstantiated card
  // products; validates URLs via isSafeUrl before storing.
  check(
    'config PATCH writes to UserProduct.pendingConfig when card is not yet bound',
    hasText(configRoute, 'category === \'card\' && !assignment.cardId') &&
      hasText(configRoute, 'pendingConfig: pending') &&
      hasText(configRoute, 'setupComplete: false, pending: true')
  );

  // P4-4 — config PATCH rejects non-displayName fields for uninstantiated
  // standees (slots/profiles do not exist until the physical standee is linked).
  check(
    'config PATCH rejects slot/social config for uninstantiated standees',
    hasText(configRoute, 'This standee is not linked yet; only its display name can be set now')
  );

  // P4-5 — GET single product synthesizes instance from pendingConfig for
  // uninstantiated assignments (no public route until linked).
  check(
    'GET single-product synthesizes instance shape from pendingConfig',
    hasText(productDetailRoute, 'else if (assignment.pendingConfig)') &&
      hasText(productDetailRoute, 'Uninstantiated assignment') &&
      hasText(productDetailRoute, 'setupComplete: false') &&
      hasText(productDetailRoute, 'redirectUrl: (pending?.redirectUrl')
  );

  // P4-6 — admin card route links an uninstantiated assignment instead of
  // returning 400, applying pendingConfig to the newly bound Card.
  const adminCardRoute = path.join(
    ROOT,
    'src',
    'app',
    'api',
    'admin',
    'users',
    '[id]',
    'products',
    '[userProductId]',
    'card',
    'route.ts'
  );
  check(
    'admin card PUT links uninstantiated assignments and applies pendingConfig',
    hasText(adminCardRoute, 'provisionCardForAssignment') &&
      hasText(adminCardRoute, 'pendingConfig') &&
      hasText(adminCardRoute, 'linked: true')
  );

  // P4-7 — config PATCH capability gate is enforced for uninstantiated cards
  // (same capMap as bound cards; no capability bypass).
  check(
    'capability gate enforced for uninstantiated card configs',
    hasText(configRoute, 'category === \'card\' && !assignment.cardId') &&
      hasText(configRoute, 'hasCapability(user._id, requiredCap')
  );

  // ── 10. P5 ADMIN CARD-LESS ASSIGNMENT UX & REVIEW DESTINATION ──────────────
  console.log('\n10) ADMIN CARD-LESS ASSIGNMENT UX & REVIEW DESTINATION');
  console.log('──');

  const adminUserDetailPage = path.join(ROOT, 'src', 'app', '(admin)', 'admin', 'users', '[id]', 'page.tsx');
  const adminUsersPage = path.join(ROOT, 'src', 'app', '(admin)', 'admin', 'users', 'page.tsx');
  const catalogValidation = path.join(ROOT, 'src', 'lib', 'validation', 'catalog.ts');

  // P5-1 — admin Assign Product modal offers card-less assignment but still
  // requires the UID when binding now; unsupported kinds stay blocked.
  check(
    'Assign Product modal offers card-less assignment (link later) but still requires UID when binding now',
    hasText(adminUserDetailPage, 'Assign without a physical card (link later)') &&
      hasText(adminUserDetailPage, "!assignWithoutCard && !assignForm.cardUid.trim()") &&
      hasText(adminUserDetailPage, 'Enter the NFC Card UID to bind')
  );
  check(
    'Create Customer modal offers card-less assignment (link later)',
    hasText(adminUsersPage, 'Assign without a physical card (link later)') &&
      hasText(adminUsersPage, "!skipCardUids[id] && !(productCardUids[id] ?? '').trim()")
  );
  check(
    'shared admin assign schema keeps cardUid optional (card-less contract)',
    hasText(catalogValidation, 'cardUid: z.string().trim().min(1).max(64).optional()')
  );

  // P5-4 — the dashboard destination label prefers the authoritative Google
  // Review URL for review-kind cards over any configured social handles.
  check(
    'My Products destination shows the authoritative Google Review URL ahead of socials',
    hasText(productsListPage, "inst.kind === 'review' && inst.reviewAssistant?.googleReviewUrl")
  );

  // ── 11. P6 PRODUCT FLOW CONSISTENCY ─────────────────────────────────────────
  console.log('\n11) P6 PRODUCT FLOW CONSISTENCY');
  console.log('──');

  const myProductsListApi = apiFileForPath('/my/products');

  // P-A1 — the My Products list endpoint represents an unbound card-category
  // assignment as a card (instanceType 'card', instance null, no permanent
  // route) so the existing needsConfig logic shows "Setup Required"/"Set Up" on
  // the list page exactly like the configuration page does.
  check(
    'list API synthesizes instanceType card only for unbound card-category assignments',
    hasText(myProductsListApi, 'else if (catalog?.category === \'card\')') &&
      hasText(myProductsListApi, "instanceType = 'card';") &&
      hasText(myProductsListApi, 'else if (assignment.standeeId)')
  );
  check(
    'list API never fabricates an instance from config (pending synthesis stays on the single-product GET)',
    hasText(myProductsListApi, "const routeSlug = (instance?.routeSlug as string | undefined) ?? ''") &&
      !hasText(myProductsListApi, 'instance = {')
  );

  // P-A2 — the configuration editor branches the success message on the PATCH
  // response shape: { assignment: { pending: true } } for unbound vs { card }
  // for bound. Bound wording is preserved verbatim.
  check(
    'config editor branches success message on assignment.pending for unbound saves',
    hasText(productPage, 'json?.assignment?.pending') &&
      hasText(productPage, 'will be applied when a physical card is linked')
  );
  check(
    'bound success message preserved verbatim',
    hasText(productPage, 'Configuration saved. Your linked QR/NFC code now opens your new destination.')
  );

  // P-D1 — the Google Review destination row keeps "Google Review" as the label
  // but links through the permanent /r/ entry point (never past it).
  check(
    'review destination href resolves through the permanent route, label unchanged',
    hasText(productsListPage, 'publicUrlFull ?? inst.reviewAssistant.googleReviewUrl') &&
      hasText(productsListPage, "label: 'Google Review'")
  );

  // ── 12. P7 PRODUCT-STATUS SURFACE + PLATFORM ROW DE-DUPLICATION ─────────────
  console.log('\n12) P7 PRODUCT-STATUS SURFACE + PLATFORM ROW DE-DUPLICATION');
  console.log('──');

  // P7-2 — standee readiness derives from slot destinations, never a persisted
  // setup flag, so the overview, list page and slot manager can never disagree.
  const standeeModel = path.join(ROOT, 'src', 'models', 'Standee.ts');
  check(
    'P7-2. standee model has no persisted setupComplete (state derives from slot destinations)',
    !hasText(standeeModel, 'setupComplete')
  );
  check(
    'P7-1/2. shared product-status helper module exists',
    existsSync(path.join(ROOT, 'src', 'lib', 'product-status.ts'))
  );
  check(
    'P7-2. helper counts only slots pointing at a non-empty destination',
    standeeConfiguredSlotCount({
      socialQrs: [
        { destinationUrl: '' },
        { destinationUrl: '   ' },
        { destinationUrl: 'https://instagram.com/x' },
        {},
      ],
    }) === 1
  );
  check(
    'P7-2. standee with zero configured slots needs setup',
    standeeNeedsSetup({ socialQrs: [] }) === true &&
      standeeNeedsSetup({ socialQrs: [{ destinationUrl: '' }] }) === true &&
      standeeNeedsSetup({ socialQrs: [{ destinationUrl: '  ' }] }) === true &&
      standeeNeedsSetup(null) === true
  );
  check(
    'P7-2. standee with a configured slot is live',
    standeeConfigured({ socialQrs: [{ destinationUrl: 'https://facebook.com/x' }] }) === true &&
      standeeNeedsSetup({ socialQrs: [{ destinationUrl: 'https://facebook.com/x' }] }) === false
  );
  check(
    'P7-1. assigned-but-not-bound card needs setup (unbound card)',
    unboundCardNeedsSetup({ instanceType: 'card', instance: null }) === true
  );
  check(
    'P7-1. bound card / standee / unknown never match the unbound case',
    unboundCardNeedsSetup({ instanceType: 'card', instance: { setupComplete: false } }) === false &&
      unboundCardNeedsSetup({ instanceType: 'standee', instance: null }) === false &&
      unboundCardNeedsSetup({ instanceType: null, instance: null }) === false
  );

  check(
    'P7-1/2. overview badgeFor surfaces unbound-card and standee setup state via shared helpers',
    hasText(myProductsCard, 'unboundCardNeedsSetup(p)') &&
      hasText(myProductsCard, 'p.instanceType === \'standee\' && standeeNeedsSetup(inst)') &&
      hasText(myProductsCard, 'p.instanceType === \'standee\' && standeeConfigured(inst)') &&
      hasText(myProductsCard, "from '@/lib/product-status'")
  );
  check(
    'P7-1/2. My Products list needsConfig covers unbound cards and standees via shared helpers',
    hasText(productsListPage, 'unboundCardNeedsSetup(product)') &&
      hasText(productsListPage, 'standeeNeedsSetup(inst)') &&
      hasText(productsListPage, 'standeeConfigured(inst)') &&
      hasText(productsListPage, 'standeeConfigured, standeeNeedsSetup, unboundCardNeedsSetup')
  );

  // P7-3 — platform rows resolving to an already-visible management row are
  // dropped; rows resolving to a card editor or the My Products hub are kept.
  const standeeOnlyDest: Record<string, string> = {
    '/dashboard/instagram': '/dashboard/standees',
    '/dashboard/reviews': '/dashboard/standees',
    '/dashboard/facebook': '/dashboard/standees',
    '/dashboard/whatsapp': '/dashboard/standees',
  };
  const aio4Caps = getProductCapabilities('ALL_IN_ONE_STANDEE_4');
  const platformLabels = ['LinkedIn', 'Instagram', 'Google Reviews', 'Facebook', 'WhatsApp'];
  const standeeOnlyNav = dedupeNavByDestination(
    filterNavByCapabilities(CUSTOMER_NAV_ITEMS, aio4Caps),
    standeeOnlyDest
  );
  const standeeOnlyLabels = labelOf(standeeOnlyNav);
  check(
    'P7-3. standee-only customer: four platform rows collapse into the single Standees row',
    ['Dashboard', 'My Products', 'Settings', 'Standees'].every((l) => standeeOnlyLabels.includes(l)) &&
      !platformLabels.some((l) => standeeOnlyLabels.includes(l))
  );

  const mixedDest: Record<string, string> = {
    '/dashboard/instagram': '/dashboard/vcards/card-42/edit',
    '/dashboard/reviews': '/dashboard/standees',
    '/dashboard/facebook': '/dashboard/standees',
    '/dashboard/whatsapp': '/dashboard/standees',
  };
  const mixedNav = dedupeNavByDestination(
    filterNavByCapabilities(
      CUSTOMER_NAV_ITEMS,
      [...new Set([...aio4Caps, ...getProductCapabilities('INSTA_CARD')])]
    ),
    mixedDest
  );
  const mixedLabels = labelOf(mixedNav);
  check(
    'P7-3. standee + Instagram card: Instagram row kept (its card editor), other platform rows dropped',
    mixedLabels.includes('Instagram') &&
      !['Google Reviews', 'Facebook', 'WhatsApp'].some((l) => mixedLabels.includes(l)) &&
      mixedLabels.includes('Standees')
  );

  const unboundDest: Record<string, string> = { '/dashboard/linkedin': '/dashboard/products' };
  const unboundNav = dedupeNavByDestination(
    filterNavByCapabilities(CUSTOMER_NAV_ITEMS, getProductCapabilities('LINKEDIN_CARD')),
    unboundDest
  );
  check(
    'P7-1/3. unbound LinkedIn card keeps its platform row (My Products hub is universal, never de-duplicated)',
    labelOf(unboundNav).join('|') === ['Dashboard', 'My Products', 'LinkedIn', 'Settings', 'Analytics'].join('|')
  );

  const instaBoundNav = dedupeNavByDestination(
    filterNavByCapabilities(CUSTOMER_NAV_ITEMS, getProductCapabilities('INSTA_CARD')),
    { '/dashboard/instagram': '/dashboard/vcards/card-9/edit' }
  );
  check(
    'P7-3. bound card row targeting its vCard editor is preserved',
    labelOf(instaBoundNav).join('|') ===
      ['Dashboard', 'My Products', 'Instagram', 'Settings', 'Analytics'].join('|')
  );
  check(
    'P7-3. empty destinations map is a no-op (no de-duplication without resolution)',
    labelOf(
      dedupeNavByDestination(
        filterNavByCapabilities(CUSTOMER_NAV_ITEMS, getProductCapabilities('INSTA_CARD')),
        {}
      )
    ).join('|') === ['Dashboard', 'My Products', 'Instagram', 'Settings', 'Analytics'].join('|')
  );

  // P7-3 wiring — server resolves destinations, shell threads them to the Navbar,
  // and platform-redirect.ts still owns the standalone redirect semantics.
  const navbarFile = path.join(ROOT, 'src', 'components', 'layout', 'navbar.tsx');
  const dashboardLayout = path.join(ROOT, 'src', 'app', '(dashboard)', 'layout.tsx');
  const platformNav = path.join(ROOT, 'src', 'lib', 'auth', 'platform-nav.ts');
  check(
    'P7-3. navbar de-duplicates platform rows after capability filtering',
    hasText(navbarFile, 'dedupeNavByDestination(') && hasText(navbarFile, 'platformDestinations')
  );
  check(
    'P7-3. dashboard server layout resolves platform row destinations once',
    hasText(dashboardLayout, 'resolvePlatformRowDestinations(') &&
      hasText(dashboardLayout, 'platformDestinations={platformDestinations}')
  );
  check(
    'P7-3. platform-nav mirrors the redirect preference set (card editor / standees / vcards / products)',
    existsSync(platformNav) &&
      hasText(platformNav, 'resolvePlatformRowDestinations(') &&
      hasText(platformNav, '/dashboard/vcards/') &&
      hasText(platformNav, '/dashboard/standees') &&
      hasText(platformNav, '/dashboard/vcards') &&
      hasText(platformNav, '/dashboard/products')
  );
  check(
    'P7-3. platform-redirect.ts unchanged (keeps preference-0 card editor resolution)',
    hasText(path.join(ROOT, 'src', 'lib', 'auth', 'platform-redirect.ts'), 'resolvePlatformCardEditor')
  );

  console.log('\n8) P10 — NO SWITCHABLE CUSTOMER CRM IN THE NAVBAR');
  console.log('──');

  check(
    'P10. navbar no longer brands a "Customer CRM" mode',
    !hasText(navbarFile, 'Customer CRM')
  );
  check(
    'P10. navbar no longer switches to/from the Admin Panel',
    !hasText(navbarFile, 'Go to Customer CRM') && !hasText(navbarFile, 'Go to Admin Panel')
  );
  check(
    'P10. navbar no longer renders the switch control (ArrowLeftRight)',
    !hasText(navbarFile, 'ArrowLeftRight')
  );
  check(
    'P10. admin navigation wiring still intact',
    hasText(navbarFile, 'ADMIN_NAV_ITEMS') && hasText(navbarFile, 'isInAdminSection')
  );
  check(
    'P10. customer navigation wiring still intact',
    hasText(navbarFile, 'CUSTOMER_NAV_ITEMS') && hasText(navbarFile, 'filterNavByCapabilities(')
  );

  console.log('\n──');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
}

main();