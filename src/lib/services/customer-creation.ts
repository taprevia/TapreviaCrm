import Card from '@/models/Card';
import Profile from '@/models/Profile';
import Standee from '@/models/Standee';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { findCardByUid, normalizeCardUidInput, uidConflictForUser } from '@/lib/services/card-identity';
import { ensureUserBizSlug } from '@/lib/services/human-url';

/**
 * Transactional admin customer creation.
 *
 * Customer + products + physical-card bindings are ONE logical operation. The
 * deployment is a standalone MongoDB (no replica set), so multi-document
 * transactions are unavailable; we instead preflight every conflict BEFORE any
 * write and compensate (roll back) every record created by this call if any
 * later step fails. A partial customer is never left behind.
 *
 *   BEGIN (preflight) → Create User → Create Profile → Create UserProducts
 *   + bind Cards → COMMIT | ROLLBACK (compensate all side effects)
 */

type CardMaterial = 'pvc' | 'metal' | 'wooden';

export interface CreateCustomerProductInput {
  catalogProductId: string;
  quantity?: number;
  cardUid?: string;
  platforms?: string[];
  notes?: string;
  material?: CardMaterial;
}

export interface CreateCustomerArgs {
  name: string;
  email: string;
  password: string;
  /** Optional explicit company public URL slug, set by the admin at creation. */
  urlSlug?: string;
  products: CreateCustomerProductInput[];
  assignedBy: string;
}

export type CreateCustomerResult =
  | { ok: true; status: 201; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

type AssignedResult = Awaited<ReturnType<typeof assignUserProduct>>;

/** Compensating rollback of every side-effect created by this call. */
async function compensateCreated(userId: unknown, products: AssignedResult[]): Promise<void> {
  const released = new Set<string>();

  for (const entry of products.reverse()) {
    if (!entry.ok) continue;
    const { userProduct, card, standee, cardCreated } = entry.data;
    if (userProduct?.cardId) {
      await UserProduct.deleteOne({ _id: userProduct._id }).catch(() => undefined);
    }
    if (card) {
      if (cardCreated) {
        await Card.deleteOne({ _id: card._id }).catch(() => undefined);
      } else if (!released.has(card._id.toString())) {
        released.add(card._id.toString());
        await Card.updateOne(
          { _id: card._id, assignedUserId: userId },
          {
            $set: {
              assignedUserId: null,
              userId: null,
              status: 'unassigned',
              isActive: false,
              kind: 'profile',
            },
          }
        ).catch(() => undefined);
      }
    }
    if (standee) {
      await Standee.deleteOne({ _id: standee._id }).catch(() => undefined);
    }
  }

  await Profile.deleteOne({ userId }).catch(() => undefined);
  await User.deleteOne({ _id: userId }).catch(() => undefined);
}

export async function createCustomerWithProducts(
  args: CreateCustomerArgs
): Promise<CreateCustomerResult> {
  const email = args.email.trim().toLowerCase();

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return { ok: false, status: 409, error: 'Email already registered' };
  }

  // ── Preflight: resolve authoritative product definitions + validate UIDs ──
  const results: Array<{ input: CreateCustomerProductInput; item: unknown }> = [];
  const usedUids = new Set<string>();

  for (const input of args.products) {
    const item = await CatalogProduct.findById(input.catalogProductId);
    if (!item) {
      return { ok: false, status: 400, error: 'Invalid product.' };
    }
    if (!item.active) {
      return { ok: false, status: 400, error: `Product '${item.name}' is inactive.` };
    }

    if (item.category === 'card') {
      const cardUid = input.cardUid?.trim();
      if (!cardUid || !normalizeCardUidInput(cardUid)) {
        return { ok: false, status: 400, error: 'Card UID is required for this product.' };
      }
      const normalized = normalizeCardUidInput(cardUid)!;
      if (usedUids.has(normalized)) {
        return {
          ok: false,
          status: 409,
          error: 'This Card UID is already used for another selected product.',
        };
      }
      usedUids.add(normalized);

      // UID must not already be bound to another customer.
      const existingCard = await findCardByUid(normalized);
      if (existingCard) {
        const { blocked } = uidConflictForUser(existingCard, '');
        if (blocked) {
          return {
            ok: false,
            status: 409,
            error: 'This Card UID is already assigned to another customer.',
          };
        }
      }
    }

    results.push({ input, item });
  }

  // ── Commit phase (with compensating rollback) ─────────────────────────────
  let user: InstanceType<typeof User> | null = null;
  const created: AssignedResult[] = [];

  try {
    user = await User.create({
      name: args.name.trim(),
      email,
      passwordHash: args.password,
      role: 'customer',
      status: 'active',
    });

    await Profile.create({
      userId: user._id,
      personalInfo: { fullName: args.name.trim() },
    });

    // Every customer owns a company profile slug from day one (Part B). An
    // admin-supplied URL slug is used verbatim as the allocation base; when
    // omitted the slug is derived from the creation name via the shared
    // idempotent allocator — a later company-name change never regenerates it
    // (Part D).
    await ensureUserBizSlug(user, args.urlSlug?.trim() || user.name);

    for (const { input, item } of results) {
      const result = await assignUserProduct({
        user,
        catalogItem: item as InstanceType<typeof CatalogProduct>,
        quantity:
          typeof input.quantity === 'number' && Number.isInteger(input.quantity)
            ? Math.min(Math.max(input.quantity, 1), 99)
            : 1,
        cardUid: input.cardUid?.trim(),
        platforms: Array.isArray(input.platforms) ? input.platforms : undefined,
        notes: input.notes,
        assignedBy: args.assignedBy,
        material: input.material ?? 'pvc',
      });
      if (!result.ok) {
        await compensateCreated(user._id, [...created, result]);
        return { ok: false, status: result.status, error: result.error };
      }
      created.push(result);
    }

    const cardCount = created.filter((r) => r.ok && r.data.card).length;
    const standeeCount = created.filter((r) => r.ok && r.data.standee).length;

    return {
      ok: true,
      status: 201,
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          customerId: user.customerId,
          bizSlug: user.bizSlug,
        },
        products: created.filter((r) => r.ok).map((r) => r.data),
        cardCount,
        standeeCount,
      },
    };
  } catch (error) {
    if (user) {
      await compensateCreated(user._id, created).catch(() => undefined);
    }
    throw error;
  }
}