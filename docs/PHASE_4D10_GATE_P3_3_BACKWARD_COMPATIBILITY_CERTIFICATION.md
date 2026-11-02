# TAPREVIA — PHASE 4D.10 P3.3 BACKWARD-COMPATIBILITY CERTIFICATION

**Status:** PASS for the locally tested scope; full external verification pending.

## Certified

| Contract | Evidence | Result |
|---|---|---|
| Existing accounts/auth | Auth suite 7/7; login/logout smoke | PASS |
| Password reset | 18/18 | PASS |
| Card IDs/UIDs/aliases/slugs | P3.3 synthetic snapshots + P2.7 harness | Unchanged |
| Standee IDs/routes | Standee lifecycle 24/24; BC harness | Unchanged |
| NFC/QR routes | Dynamic routing 29/29; `/r`/`/qr` smoke | PASS |
| Google destinations | Existing fixture values; no writes except explicit test edit | Unchanged |
| Social destinations | Explicit product edit persisted only that product | PASS |
| ReviewSettings / legacy / central / hybrid | 4D.5 57/57 ×2; BC harness 11/11 | PASS |
| Missing central settings | BC harness central OFF | PASS |
| Feature flags OFF | Matrix 192/192; all suites default OFF | PASS |
| Flags ON combinations | Matrix 192/192 | PASS |
| Lower-tier denial | Entitlement 130/130 | PASS |
| Historical analytics | 9/9; no read-side mutations | PASS |
| Review Library/import | 48/48 + 13/13 | PASS |
| QR PDF / VCF | PASS / 69/69 | PASS |
| Admin/Customer URL parity | Canonical review URL same both sides | PASS |
| Product edit/save/reload | Destination UI + DB verified | PASS |
| Legacy public routes | Page smoke + dynamic suite | PASS |
| No customer reconfiguration | Legacy/central/hybrid readers retained | PASS |

## Snapshot / mutation safety

P2.7 compatibility harness snapshots users, profiles, catalog, cards, standees,
assignments, ReviewSettings, categories, templates, rotation events/state and
analytics before/after resolution:

- **11/11 checks passed, central gate OFF**
- **11/11 checks passed, central gate ON**
- **Zero collection mutations**

P3.3 destination test intentionally changed only the synthetic social card's
`redirectUrl` (the action under test), with before/after DB verification. No
other product or destination was modified.

## URL certification

- Canonical review/profile/social URLs resolve from the authoritative resolver.
- Permanent `/r`/`/qr`/`/c` routes remain functional and are visible only in
  Admin User Details.
- No alias/UID/routeSlug/publicSlug or printed destination was rewritten.
- `/admin/standee-qr` intentional redirect to `/admin/users`.

## Exclusions

- Live AI provider, Vercel Preview/Production, external Google navigation.
- Physical NFC/QR scans, devices, TalkBack/VoiceOver.
- Exhaustive 99-method API and every UI-action execution.
- Real customer data/ownership and dependency advisories.

**Certification:** no backward-compatibility regression was observed in the
locally executed scope. Full certification requires the excluded external and
exhaustive-coverage checks.
