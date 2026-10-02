import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { requireAuth } from '@/lib/auth';
import Card from '@/models/Card';
import Product from '@/models/Product';
import Profile from '@/models/Profile';
import Inquiry from '@/models/Inquiry';
import Appointment from '@/models/Appointment';
import ProductEnquiry from '@/models/ProductEnquiry';
import NewsletterSubscriber from '@/models/NewsletterSubscriber';
import Media from '@/models/Media';
import { getStorage } from '@/lib/storage';
import { updateCardSchema } from '@/lib/validation/card';
import { fail, ok } from '@/lib/api';
import { getOwnedCard, canEditCardExperience } from '@/lib/services/card-access';
import { availableTemplatesForUser } from '@/lib/services/template-access';
import { canUseFeature, featureMax } from '@/lib/services/feature-access';

type Params = { params: { id: string } };

// GET /api/cards/[id]
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const result = await getOwnedCard(params.id, user);
    if (result.status === 'not_found') return fail(404, 'NOT_FOUND', 'Card not found');
    if (result.status === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');

    if (!(await canEditCardExperience(user, result.card))) {
      return fail(403, 'FORBIDDEN', 'Your products do not include this card experience');
    }

    return ok({ card: result.card });
  } catch (error) {
    console.error('Card GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// PATCH /api/cards/[id] — deep-partial update
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const result = await getOwnedCard(params.id, user);
    if (result.status === 'not_found') return fail(404, 'NOT_FOUND', 'Card not found');
    if (result.status === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');

    if (!(await canEditCardExperience(user, result.card))) {
      return fail(403, 'FORBIDDEN', 'Your products do not include this card experience');
    }
    const card = result.card;

    const body = await request.json().catch(() => null);
    const parsed = updateCardSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }
    const data = parsed.data;

    // Card kind is controlled by product allocation (admin authoritative).
    // Customers must never change their card's experience directly.
    if (data.kind !== undefined && data.kind !== (card.kind ?? 'profile') && user.role !== 'admin') {
      return fail(403, 'FORBIDDEN', 'Card kind is set by product allocation and cannot be changed.');
    }

    if (data.urlAlias && data.urlAlias !== card.urlAlias) {
      const alias = data.urlAlias;
      const clash = await Card.findOne({ urlAlias: alias }).lean();
      if (clash) return fail(409, 'CONFLICT', 'This alias is already taken');
      card.urlAlias = alias;
    }

    // Template switching is limited to the templates granted to the card owner.
    if (data.templateKey) {
      const ownerId = (card.userId ?? card.assignedUserId)?.toString();
      const allowed = await availableTemplatesForUser(ownerId);
      if (!allowed.includes(data.templateKey)) {
        return fail(403, 'FORBIDDEN', 'This template is not enabled for your account');
      }
    }

    // Product feature gate: the experience this card belongs to must be part
    // of the owner's purchased products, plus any key-specific limits.
    const ownerId = (card.userId ?? card.assignedUserId)?.toString();
    const kindToKey = { profile: 'profile', review: 'review', social: 'social' } as const;
    const requiredKey = kindToKey[(card.kind ?? 'profile') as keyof typeof kindToKey] ?? 'profile';
    const [hasKindFeature, socialMax] = await Promise.all([
      canUseFeature(ownerId, requiredKey),
      featureMax(ownerId, 'social'),
    ]);
    if (!hasKindFeature) {
      return fail(
        403,
        'FORBIDDEN',
        'This card experience is not included in your current products'
      );
    }
    if (data.socialLinks !== undefined) {
      if (!(await canUseFeature(ownerId, 'social'))) {
        return fail(403, 'FORBIDDEN', 'Social links are not included in your current products');
      }
      if (socialMax !== undefined && data.socialLinks.length > socialMax) {
        return fail(400, 'VALIDATION_ERROR', `Maximum ${socialMax} social links allowed`);
      }
    }
    if (data.reviewAssistant) {
      if (!(await canUseFeature(ownerId, 'review'))) {
        return fail(403, 'FORBIDDEN', 'The AI Review Assistant is not included in your current products');
      }
    }

    if (data.basic) {
      for (const [key, value] of Object.entries(data.basic)) {
        if (value !== undefined) {
          (card.basic as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
    if (data.location) {
      for (const [key, value] of Object.entries(data.location)) {
        if (value !== undefined) {
          (card.location as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
    if (data.banner) {
      for (const [key, value] of Object.entries(data.banner)) {
        if (value !== undefined) {
          (card.banner as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
    if (data.config) {
      for (const [key, value] of Object.entries(data.config)) {
        if (value !== undefined) {
          (card.config as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
    if (data.sections) {
      for (const [key, value] of Object.entries(data.sections)) {
        if (value !== undefined) {
          (card.sections as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }

    if (data.businessHours) {
      const byDay = new Map(data.businessHours.map((h) => [h.day, h]));
      card.businessHours = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
        (day) => byDay.get(day as never) ?? { day: day as never, enabled: false, from: '', to: '' }
      );
    }
    if (data.socialLinks) card.socialLinks = data.socialLinks;
    if (data.reviewAssistant) {
      if (!card.reviewAssistant) card.reviewAssistant = {} as never;
      for (const [key, value] of Object.entries(data.reviewAssistant)) {
        if (value !== undefined) {
          (card.reviewAssistant as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
    if (data.themeConfig) {
      for (const [key, value] of Object.entries(data.themeConfig)) {
        if (value !== undefined) {
          (card.themeConfig as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }

    for (const key of [
      'name',
      'cardLabel',
      'occupation',
      'descriptionHtml',
      'templateKey',
      'galleryImages',
      'services',
      'isActive',
      'coverType',
      'coverStyle',
      'coverValue',
      'profileImageUrl',
      'privacyPolicyHtml',
      'termsHtml',
      'kind',
      'redirectUrl',
    ] as const) {
      const value = data[key];
      if (value !== undefined) {
        (card as unknown as Record<string, unknown>)[key] = value;
      }
    }

    await card.save();
    return ok({ card });
  } catch (error) {
    console.error('Card PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// DELETE /api/cards/[id]
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include vCards');

    await connectDB();
    const result = await getOwnedCard(params.id, user);
    if (result.status === 'not_found') return fail(404, 'NOT_FOUND', 'Card not found');
    if (result.status === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');

    // A physical NFC card is a business asset; customers may not delete it.
    if (result.card.assignedUserId !== null && user.role !== 'admin') {
      return fail(403, 'FORBIDDEN', 'Assigned NFC cards cannot be deleted from here');
    }

    const cardId = result.card._id;

    // Card images (avatar/cover/gallery/product) are keyed to the card. Delete
    // each stored object first — that frees bucket bytes — then the rows.
    const media = await Media.find({ cardId }).select('key').lean();
    for (const row of media) {
      try {
        await getStorage().deleteObject(row.key);
      } catch (storageErr) {
        console.error(`Card media storage delete failed for key=${row.key}:`, storageErr);
      }
    }
    await Media.deleteMany({ cardId });

    await Promise.all([
      Product.deleteMany({ cardId }),
      Inquiry.deleteMany({ cardId }),
      Appointment.deleteMany({ cardId }),
      ProductEnquiry.deleteMany({ cardId }),
      NewsletterSubscriber.deleteMany({ cardId }),
      Profile.updateMany({ cardId }, { $set: { cardId: null } }),
    ]);
    await Card.deleteOne({ _id: cardId });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Card DELETE error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
