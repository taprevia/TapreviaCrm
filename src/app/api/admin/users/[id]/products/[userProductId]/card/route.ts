import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { z } from 'zod';
import User from '@/models/User';
import Card from '@/models/Card';
import Profile from '@/models/Profile';
import UserProduct from '@/models/UserProduct';
import { replaceCardForAssignment } from '@/lib/services/card-replacement';
import { provisionCardForAssignment } from '@/lib/services/card-identity';
import { deriveCardKind } from '@/lib/services/product-experience';
import { ensureCardPublicSlug } from '@/lib/services/human-url';

const replaceCardSchema = z.object({
  cardUid: z.string().trim().min(1).max(64),
});

type Params = { params: { id: string; userProductId: string } };

/**
 * Replace the physical NFC card behind a product assignment.
 *
 * The Card document (digital profile + product config + permanent routeSlug)
 * is preserved; only the physical UID is swapped, with an audit trail in
 * `previousCardUids`. The new UID must not be bound to another customer.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();

    const body = await request.json().catch(() => null);
    const parsed = replaceCardSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Validation failed', parsed.error.flatten().fieldErrors);
    }

    const user = await User.findById(params.id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const userProduct = await UserProduct.findOne({
      _id: params.userProductId,
      userId: user._id,
    }).populate('catalogProductId', 'name slug kind category');
    if (!userProduct) {
      return fail(404, 'NOT_FOUND', 'User product not found');
    }

    // ── Uninstantiated assignment → bind the physical card now ──────────────
    // If no cardId has been set yet, provision the card, apply any pending
    // configuration that was saved while uninstantiated, link it to the user's
    // profile, and clear the pending state — the instance is authoritative.
    if (!userProduct.cardId) {
      const catalog = userProduct.catalogProductId as { name?: string; slug?: string; kind?: string; category?: string } | null;
      if (!catalog || catalog.category !== 'card') {
        return fail(400, 'BAD_REQUEST', 'This product cannot be linked to a physical NFC card');
      }
      const derivedKind = deriveCardKind(catalog.kind ?? '');
      if (!derivedKind) {
        return fail(400, 'BAD_REQUEST', 'Product kind cannot be allocated to a Card');
      }

      const provisioned = await provisionCardForAssignment({
        uid: parsed.data.cardUid,
        userId: user._id.toString(),
        userName: user.name,
        productName: catalog?.name,
        kind: derivedKind,
      });
      if (!provisioned.ok) {
        return fail(provisioned.status, provisioned.status === 409 ? 'CONFLICT' : 'BAD_REQUEST', provisioned.error);
      }

      const card = provisioned.card;

      // Apply any configuration that was stored on the assignment while it had
      // no physical instance (UserProduct.pendingConfig). This ensures the card
      // is ready to serve traffic immediately after linking.
      const pending = (userProduct as unknown as { pendingConfig: Record<string, unknown> | null }).pendingConfig;
      if (pending) {
        card.redirectUrl = (pending.redirectUrl as string | undefined) ?? card.redirectUrl;
        // Carry the product title (cardLabel) from the assignment to the bound
        // card so a rename made before linking survives the bind.
        if (typeof pending.cardLabel === 'string' && pending.cardLabel.trim()) {
          card.cardLabel = pending.cardLabel;
        }
        if (pending.instagramConfig) card.instagramConfig = pending.instagramConfig;
        if (pending.whatsappConfig) card.whatsappConfig = pending.whatsappConfig;
        if (pending.linkedinConfig) card.linkedinConfig = pending.linkedinConfig;
        if (pending.facebookConfig) card.facebookConfig = pending.facebookConfig;
        if (pending.reviewAssistant) card.reviewAssistant = pending.reviewAssistant;
        card.setupComplete = true;
        await card.save();
        (userProduct as unknown as { pendingConfig: null }).pendingConfig = null;
      }

      userProduct.cardId = card._id;
      await userProduct.save();

      await Profile.findOneAndUpdate(
        { userId: user._id },
        { $setOnInsert: { userId: user._id }, $set: { cardId: card._id } },
        { upsert: true }
      );

      try {
        await ensureCardPublicSlug(card._id, user._id.toString());
      } catch (error) {
        console.error('ensureCardPublicSlug failed:', error);
      }

      return ok({
        card: {
          _id: card._id,
          cardUid: card.cardUid,
          slug: card.slug,
          kind: card.kind,
          setupComplete: card.setupComplete,
        },
        replacedBy: admin.user._id,
        linked: true,
      });
    }

    // ── Existing card → replace the physical UID (existing behavior) ────────

    const card = await Card.findById(userProduct.cardId);
    if (!card) {
      return fail(404, 'NOT_FOUND', 'Physical card not found');
    }

    const result = await replaceCardForAssignment({
      card,
      ownerUserId: user._id.toString(),
      newUid: parsed.data.cardUid,
    });
    if (!result.ok) {
      return fail(result.status, result.status === 409 ? 'CONFLICT' : 'BAD_REQUEST', result.error);
    }

    return ok({ card: result.data, replacedBy: admin.user._id });
  } catch (error) {
    console.error('Admin card replacement error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}