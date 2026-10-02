import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import Profile from '@/models/Profile';
import UserProduct from '@/models/UserProduct';
import { updateProductConfigSchema } from '@/lib/validation/product-config';
import { hasCapability } from '@/lib/services/capability-access';

type Params = { params: { id: string } };

function isSafeUrl(v: string): boolean {
  if (!v || v.length > 2048) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * PATCH /api/my/products/[id]/config — update a product's destination configuration.
 *
 * The [id] is the UserProduct assignment ID. This endpoint verifies ownership
 * and capability before allowing changes.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();

    // Find the assignment and verify ownership.
    const assignment = await UserProduct.findOne({
      _id: params.id,
      userId: user._id,
      status: 'active',
    }).populate('catalogProductId', 'slug kind category');

    if (!assignment) {
      return fail(404, 'NOT_FOUND', 'Product assignment not found');
    }

    const catalog = assignment.catalogProductId as { slug?: string; kind?: string; category?: string } | null;
    const kind = catalog?.kind ?? '';
    const category = catalog?.category ?? '';

    const body = await request.json().catch(() => null);
    const parsed = updateProductConfigSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid configuration', parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;

    // ── Card-based products ──────────────────────────────────────────────
    if (category === 'card' && assignment.cardId) {
      const card = await Card.findById(assignment.cardId);
      if (!card) return fail(404, 'NOT_FOUND', 'Card not found');

      // Capability check based on product kind.
      const capMap: Record<string, string> = {
        instagram: 'instagram',
        review: 'google_review',
        social: 'dynamic_link',
        profile: 'public_profile',
      };
      const requiredCap = capMap[kind] ?? 'dynamic_link';
      const allowed = await hasCapability(user._id, requiredCap as 'instagram' | 'google_review' | 'dynamic_link' | 'public_profile');
      if (!allowed) {
        return fail(403, 'FORBIDDEN', 'Your products do not include this capability');
      }

      // Apply configuration based on product kind.
      if (kind === 'social' && data.destinationUrl) {
        if (!isSafeUrl(data.destinationUrl)) {
          return fail(400, 'VALIDATION_ERROR', 'Invalid destination URL');
        }
        card.redirectUrl = data.destinationUrl;
      }

      if (data.instagram) {
        if (data.instagram.profileUrl && !isSafeUrl(data.instagram.profileUrl)) {
          return fail(400, 'VALIDATION_ERROR', 'Invalid Instagram profile URL');
        }
        card.instagramConfig = {
          username: data.instagram.username ?? card.instagramConfig?.username ?? '',
          profileUrl: data.instagram.profileUrl ?? card.instagramConfig?.profileUrl ?? '',
          reelsUrl: data.instagram.reelsUrl ?? card.instagramConfig?.reelsUrl ?? '',
          postsUrl: data.instagram.postsUrl ?? card.instagramConfig?.postsUrl ?? '',
          dmUrl: data.instagram.dmUrl ?? card.instagramConfig?.dmUrl ?? '',
          shopUrl: data.instagram.shopUrl ?? card.instagramConfig?.shopUrl ?? '',
        };
        // Also set redirectUrl for social card redirect. Scoped to social
        // cards: redirectUrl is the tap destination of a free-destination
        // product allocation and must never be clobbered for review/profile
        // cards. A review card's tap goes to /review/[alias] instead.
        if (kind === 'social' && card.instagramConfig.profileUrl) {
          card.redirectUrl = card.instagramConfig.profileUrl;
        }
      }

      if (kind === 'review' && data.googleReview) {
        if (data.googleReview.googleReviewUrl && !isSafeUrl(data.googleReview.googleReviewUrl)) {
          return fail(400, 'VALIDATION_ERROR', 'Invalid Google Review URL');
        }
        if (!card.reviewAssistant) {
          card.reviewAssistant = {
            enabled: true,
            googleReviewUrl: '',
            writingStyle: 'friendly',
            preferredLength: 'medium',
            languages: ['English'],
            feedbackTopics: [],
            welcomeMessage: '',
          };
        }
        if (data.googleReview.googleReviewUrl) {
          card.reviewAssistant.googleReviewUrl = data.googleReview.googleReviewUrl;
        }
        // Do NOT force enabled=true here. The Review Assistant publish switch
        // is owned by the builder (PATCH /api/cards/[id]); forcing it on would
        // silently re-enable a flow the owner disabled. A brand-new
        // reviewAssistant already initializes enabled:true above, so the first
        // legacy-dashboard save still activates the flow.
      }

      if (kind === 'profile' && data.linkedin) {
        card.linkedinConfig = {
          profileUrl: data.linkedin.profileUrl ?? card.linkedinConfig?.profileUrl ?? '',
          resumeUrl: data.linkedin.resumeUrl ?? card.linkedinConfig?.resumeUrl ?? '',
        };
        if (card.linkedinConfig.profileUrl) {
          card.redirectUrl = card.linkedinConfig.profileUrl;
        }
      }

      if (kind === 'profile' && data.facebook) {
        card.facebookConfig = {
          profileUrl: data.facebook.profileUrl ?? card.facebookConfig?.profileUrl ?? '',
          pageUrl: data.facebook.pageUrl ?? card.facebookConfig?.pageUrl ?? '',
          messengerUrl: data.facebook.messengerUrl ?? card.facebookConfig?.messengerUrl ?? '',
        };
        if (card.facebookConfig.profileUrl) {
          card.redirectUrl = card.facebookConfig.profileUrl;
        }
      }

      if (data.whatsapp) {
        card.whatsappConfig = {
          phoneNumber: data.whatsapp.phoneNumber ?? card.whatsappConfig?.phoneNumber ?? '',
          defaultMessage: data.whatsapp.defaultMessage ?? card.whatsappConfig?.defaultMessage ?? '',
        };
      }

      // Mark setup as complete.
      card.setupComplete = true;
      await card.save();

      return ok({
        card: {
          id: card._id,
          routeSlug: card.routeSlug,
          kind: card.kind,
          redirectUrl: card.redirectUrl,
          setupComplete: card.setupComplete,
          instagramConfig: card.instagramConfig,
          whatsappConfig: card.whatsappConfig,
          linkedinConfig: card.linkedinConfig,
          facebookConfig: card.facebookConfig,
          reviewAssistant: card.reviewAssistant,
        },
      });
    }

    // ── Standee-based products ───────────────────────────────────────────
    if (category === 'standee' && assignment.standeeId) {
      const allowed = await hasCapability(user._id, 'standee');
      if (!allowed) {
        return fail(403, 'FORBIDDEN', 'Your products do not include standee capability');
      }

      const standee = await Standee.findById(assignment.standeeId);
      if (!standee) return fail(404, 'NOT_FOUND', 'Standee not found');

      // Public display name for the panel/QR picker page.
      if (data.displayName !== undefined) {
        await Standee.updateOne(
          { _id: standee._id },
          { $set: { displayName: data.displayName.trim() } }
        );
        return ok({
          standee: {
            id: standee._id,
            name: standee.name,
            displayName: data.displayName.trim(),
            routeSlug: standee.routeSlug,
          },
        });
      }

      // Per-slot dynamic destination update (multi-profile standees).
      // Requirement: changing a slot's destination must ONLY affect that slot.
      if (data.slotConfig) {
        const { slot, destinationUrl, label } = data.slotConfig;
        const maxProfiles = standee.maxProfiles || standee.socialQrs?.length || 0;
        if (slot < 1 || slot > maxProfiles) {
          return fail(400, 'VALIDATION_ERROR', `Invalid slot. This standee has ${maxProfiles} slot(s).`);
        }
        const index = slot - 1;
        const slotDoc = standee.socialQrs?.[index];
        if (!slotDoc) {
          return fail(400, 'VALIDATION_ERROR', `Slot ${slot} does not exist on this standee`);
        }
        if (!isSafeUrl(destinationUrl)) {
          return fail(400, 'VALIDATION_ERROR', 'Invalid destination URL');
        }
        const update: Record<string, unknown> = {
          [`socialQrs.${index}.destinationUrl`]: destinationUrl,
        };
        if (label !== undefined) {
          update[`socialQrs.${index}.label`] = label;
        }
        await Standee.updateOne({ _id: standee._id }, { $set: update });

        return ok({
          standee: {
            id: standee._id,
            name: standee.name,
            routeSlug: standee.routeSlug,
            slot,
            platform: slotDoc.platform,
            destinationUrl,
            setupComplete: true,
          },
        });
      }

      // Update shared social links via Profile (same as existing standees page).
      const socialUpdates: Array<{ platform: string; url: string }> = [];

      if (data.instagram?.profileUrl) {
        socialUpdates.push({ platform: 'instagram', url: data.instagram.profileUrl });
      }
      if (data.googleReview?.googleReviewUrl) {
        socialUpdates.push({ platform: 'google_review', url: data.googleReview.googleReviewUrl });
      }
      if (data.whatsapp?.phoneNumber) {
        const waUrl = data.whatsapp.phoneNumber.startsWith('+')
          ? `https://wa.me/${data.whatsapp.phoneNumber.slice(1)}`
          : `https://wa.me/${data.whatsapp.phoneNumber}`;
        const msg = data.whatsapp.defaultMessage;
        socialUpdates.push({
          platform: 'whatsapp',
          url: msg ? `${waUrl}?text=${encodeURIComponent(msg)}` : waUrl,
        });
      }
      if (data.facebook?.profileUrl) {
        socialUpdates.push({ platform: 'facebook', url: data.facebook.profileUrl });
      }

      if (socialUpdates.length > 0) {
        // Merge with existing social links (preserve non-standee platforms).
        const profile = await Profile.findOne({ userId: user._id });
        const existingLinks = profile?.socialLinks ?? [];
        const updatedPlatforms = new Set(socialUpdates.map((l) => l.platform));
        const merged = [
          ...existingLinks.filter((l: { platform: string }) => !updatedPlatforms.has(l.platform)),
          ...socialUpdates,
        ];

        await Profile.findOneAndUpdate(
          { userId: user._id },
          { $set: { socialLinks: merged } },
          { upsert: true }
        );
      }

      return ok({
        standee: {
          id: standee._id,
          name: standee.name,
          routeSlug: standee.routeSlug,
          socialQrs: standee.socialQrs,
        },
      });
    }

    // ── Uninstantiated assignments (no physical Card/Standee bound yet) ──
    // The configuration is stored temporarily on the assignment itself
    // (UserProduct.pendingConfig) — a single authoritative source. There is no
    // public route until a physical instance is bound; the tap surface lives on
    // the Card/Standee. When the instance is later linked, pendingConfig is
    // applied to it and cleared (see the admin link flow).
    if (category === 'card' && !assignment.cardId) {
      const capMap: Record<string, string> = {
        instagram: 'instagram',
        review: 'google_review',
        social: 'dynamic_link',
        profile: 'public_profile',
      };
      const requiredCap = capMap[kind] ?? 'dynamic_link';
      const allowed = await hasCapability(user._id, requiredCap as 'instagram' | 'google_review' | 'dynamic_link' | 'public_profile');
      if (!allowed) {
        return fail(403, 'FORBIDDEN', 'Your products do not include this capability');
      }

      // Validate every URL that would be persisted (same rules as bound cards).
      const urlFields: Array<{ value: string | undefined; field: string }> = [
        { value: data.destinationUrl, field: 'Destination URL' },
        { value: data.instagram?.profileUrl, field: 'Instagram profile URL' },
        { value: data.googleReview?.googleReviewUrl, field: 'Google Review URL' },
        { value: data.linkedin?.profileUrl, field: 'LinkedIn profile URL' },
        { value: data.facebook?.profileUrl, field: 'Facebook profile URL' },
      ];
      for (const { value, field } of urlFields) {
        if (value !== undefined && !isSafeUrl(value)) {
          return fail(400, 'VALIDATION_ERROR', `Invalid ${field}`);
        }
      }

      // Seed the pending record from the existing config so fields the customer
      // already set (in particular the custom title `cardLabel` — the product
      // rename source) survive this save instead of being wiped.
      const priorPending =
        (assignment.pendingConfig as Record<string, unknown> | null) ?? null;
      const pending: Record<string, unknown> = {
        ...priorPending,
        kind,
      };
      if (kind === 'social' && data.destinationUrl) {
        pending.redirectUrl = data.destinationUrl.trim();
      }

      if (data.instagram) {
        pending.instagramConfig = {
          username: data.instagram.username ?? '',
          profileUrl: data.instagram.profileUrl ?? '',
          reelsUrl: data.instagram.reelsUrl ?? '',
          postsUrl: data.instagram.postsUrl ?? '',
          dmUrl: data.instagram.dmUrl ?? '',
          shopUrl: data.instagram.shopUrl ?? '',
        };
        // Same social-only redirectUrl rule as bound social cards (P2-B/P3).
        if (kind === 'social' && data.instagram.profileUrl) {
          pending.redirectUrl = data.instagram.profileUrl;
        }
      }

      if (kind === 'review' && data.googleReview?.googleReviewUrl) {
        pending.reviewAssistant = {
          enabled: true,
          googleReviewUrl: data.googleReview.googleReviewUrl,
        };
      }

      if (kind === 'profile' && data.linkedin?.profileUrl) {
        pending.linkedinConfig = { profileUrl: data.linkedin.profileUrl };
      }
      if (kind === 'profile' && data.facebook?.profileUrl) {
        pending.facebookConfig = { profileUrl: data.facebook.profileUrl };
      }
      if (data.whatsapp?.phoneNumber) {
        pending.whatsappConfig = {
          phoneNumber: data.whatsapp.phoneNumber,
          defaultMessage: data.whatsapp.defaultMessage ?? '',
        };
      }

      await UserProduct.updateOne(
        { _id: params.id, userId: user._id },
        { $set: { pendingConfig: pending } }
      );

      return ok({ assignment: { id: params.id, setupComplete: false, pending: true } });
    }

    if (category === 'standee' && !assignment.standeeId) {
      const allowed = await hasCapability(user._id, 'standee');
      if (!allowed) {
        return fail(403, 'FORBIDDEN', 'Your products do not include standee capability');
      }

      const hasConfig = Boolean(
        data.destinationUrl ||
          data.instagram ||
          data.googleReview ||
          data.whatsapp ||
          data.linkedin ||
          data.facebook ||
          data.slotConfig
      );
      if (hasConfig) {
        return fail(400, 'VALIDATION_ERROR', 'This standee is not linked yet; only its display name can be set now');
      }

      if (data.displayName !== undefined) {
        const priorPending =
          (assignment.pendingConfig as Record<string, unknown> | null) ?? null;
        await UserProduct.updateOne(
          { _id: params.id, userId: user._id },
          {
            $set: {
              // Preserve prior pending fields (title etc.) — only the display
              // name changes here.
              pendingConfig: {
                ...priorPending,
                kind: 'standee',
                displayName: data.displayName.trim(),
              },
            },
          }
        );
      }

      return ok({ assignment: { id: params.id, setupComplete: false, pending: true } });
    }

    return fail(400, 'BAD_REQUEST', 'Unsupported product type for configuration');
  } catch (error) {
    console.error('Product config PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
