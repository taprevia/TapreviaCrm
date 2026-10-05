export interface SocialLinkDto {
  platform?: string;
  url?: string;
  label?: string;
  iconUrl?: string;
  order?: number;
}

export interface ProductDto {
  _id?: string;
  productId?: string;
  name?: string;
  price?: number | string;
  description?: string;
  image?: string;
  inStock?: boolean;
  category?: string;
  material?: string;
  profileId?: string;
  quantity?: number;
}

export interface ThemeDto {
  primaryColor?: string;
  accentColor?: string;
  bgColor?: string;
  textColor?: string;
  fontFamily?: string;
  borderRadius?: string;
  template?: string;
}

/** Card theme tokens — a closed set, not an open record. */
export interface CardThemeConfigDto {
  accentColor?: string;
  bgColor?: string;
}

/** Renderer feature toggles. Values are validated upstream by Zod. */
export interface CardRenderConfigDto {
  displayLocalization?: boolean;
  displayDownloadQrIcon?: boolean;
  displayQrSection?: boolean;
  displayAddToContact?: boolean;
  hideStickyBar?: boolean;
  displayWhatsAppShare?: boolean;
  qrDownloadSize?: number;
}

export interface PublicCardDto {
  id?: string;
  cardUid?: string;
  slug?: string;
  routeSlug?: string;
  publicSlug?: string;
  displayName?: string;
  name?: string;
  title?: string;
  occupation?: string;
  bio?: string;
  descriptionHtml?: string;
  avatarUrl?: string;
  profileImageUrl?: string;
  coverImageUrl?: string;
  coverType?: string;
  coverValue?: string;
  coverStyle?: string;
  socialLinks?: SocialLinkDto[];
  products?: ProductDto[];
  theme?: ThemeDto;
  themeConfig?: CardThemeConfigDto;
  templateKey?: string;
  kind?: string;
  basic?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    /** Already public on the rendered card and in the .vcf export. */
    alternateEmail?: string;
    phone?: string;
    alternatePhone?: string;
    company?: string;
    jobTitle?: string;
    website?: string;
  };
  company?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  website?: string;
  location?: {
    address?: string;
    mapsUrl?: string;
    lat?: number;
    lng?: number;
  };
  businessHours?: Array<{
    day: string;
    enabled: boolean;
    from: string;
    to: string;
  }>;
  sections?: Record<string, boolean>;
  config?: CardRenderConfigDto;
  gallery?: Array<{
    imageUrl?: string;
    caption?: string;
  }>;
  galleryImages?: Array<{
    imageUrl?: string;
    caption?: string;
  }>;
  services?: Array<{
    title?: string;
    description?: string;
  }>;
  urlAlias?: string;
}

/**
 * Normalise a Mongo ObjectId / populated subdocument / plain string into a
 * string. Accepts `unknown` on purpose: the input is an untyped database
 * document and the goal is to survive every shape it can legally take.
 */
function toObjectIdString(id: unknown): string | undefined {
  if (!id) return undefined;
  if (typeof id === 'string') return id;
  if (typeof id === 'object') {
    const nested = (id as { _id?: unknown })._id;
    if (nested) return toObjectIdString(nested);
    const asString = String(id);
    if (asString && asString !== '[object Object]') return asString;
  }
  if (typeof id === 'number') return String(id);
  return undefined;
}

function pickSocialLinks(socialLinks: unknown): SocialLinkDto[] {
  if (!Array.isArray(socialLinks)) return [];
  return socialLinks
    .map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return null;
      const link = entry as Record<string, unknown>;
      return {
        platform: str(link.platform),
        url: str(link.url),
        label: str(link.label),
        iconUrl: str(link.iconUrl),
      };
    })
    .filter(Boolean) as SocialLinkDto[];
}

function pickProducts(products: unknown): ProductDto[] {
  if (!Array.isArray(products)) return [];
  return products
    .map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return null;
      const product = entry as Record<string, unknown>;
      return {
        _id: toObjectIdString(product._id),
        productId: str(product.productId),
        name: str(product.name),
        price:
          typeof product.price === 'number' || typeof product.price === 'string'
            ? product.price
            : undefined,
        description: str(product.description),
        image: str(product.image),
        inStock: typeof product.inStock === 'boolean' ? product.inStock : undefined,
        category: str(product.category),
        material: str(product.material),
      };
    })
    .filter(Boolean) as ProductDto[];
}

/** Anything with a Mongoose `toObject()` — a hydrated document. */
interface MaybeMongooseDoc {
  toObject?: (options?: { virtuals?: boolean }) => Record<string, unknown>;
}

/** Narrow an untyped value to a readable string. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Read a nested object off an untyped record. */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Strip keys whose value is `undefined` so the wire payload stays tidy. */
function pruneUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

/**
 * Map a stored Card document to the public-safe shape served by anonymous
 * JSON endpoints.
 *
 * This is an ALLOWLIST mapper: only fields named in `PublicCardDto` can reach
 * the output. Everything else — `_id`, `userId`, `assignedUserId`,
 * `previousCardUids`, `basic.dateOfBirth`, `stats`, tenant/admin flags — is
 * structurally unreachable, so adding a field to the Mongoose schema can never
 * accidentally publish it.
 *
 * Use this ONLY at genuine JSON API boundaries. It must never be applied to a
 * card handed to a server component such as `PublicCardPage`, which needs the
 * internal fields (`_id`, `userId`, `reviewAssistant`) to authorise and scope
 * its own queries.
 */
export function toPublicCardDto(cardDoc: unknown): PublicCardDto {
  if (!cardDoc) return {};

  const source = (cardDoc as MaybeMongooseDoc).toObject
    ? (cardDoc as MaybeMongooseDoc).toObject!({ virtuals: true })
    : (cardDoc as Record<string, unknown>);

  const card = obj(source);
  if (!card) return {};

  const basic = obj(card.basic);

  const displayName =
    str(card.displayName) ||
    str(card.name) ||
    [str(basic?.firstName), str(basic?.lastName)].filter(Boolean).join(' ').trim() ||
    str(card.cardLabel) ||
    'Unassigned Card';
  const title =
    str(card.title) ||
    str(card.occupation) ||
    str(card.jobTitle) ||
    str(basic?.jobTitle) ||
    '';
  const avatarUrl =
    str(card.avatarUrl) || str(card.profileImageUrl) || str(card.image) || '';
  const bio = str(card.bio) || str(card.description) || str(card.summary) || '';

  const dto: PublicCardDto = {
    id: toObjectIdString(card._id),
    cardUid: str(card.cardUid),
    slug: str(card.slug),
    routeSlug: str(card.routeSlug),
    publicSlug: str(card.publicSlug),
    displayName,
    name: str(card.name),
    title,
    occupation: str(card.occupation) ?? str(basic?.jobTitle) ?? str(card.jobTitle),
    bio,
    descriptionHtml: str(card.descriptionHtml),
    avatarUrl,
    profileImageUrl: str(card.profileImageUrl),
    coverImageUrl: str(card.coverImageUrl) ?? str(card.coverValue),
    coverType: str(card.coverType),
    coverValue: str(card.coverValue),
    coverStyle: str(card.coverStyle),
    socialLinks: pickSocialLinks(card.socialLinks),
    products: pickProducts(card.products),
    themeConfig: obj(card.themeConfig) as CardThemeConfigDto | undefined,
    theme: obj(card.theme) as ThemeDto | undefined,
    templateKey: str(card.templateKey),
    kind: str(card.kind),
    basic: basic
      ? {
          firstName: str(basic.firstName),
          lastName: str(basic.lastName),
          email: str(basic.email),
          alternateEmail: str(basic.alternateEmail),
          phone: str(basic.phone),
          alternatePhone: str(basic.alternatePhone),
          company: str(basic.company),
          jobTitle: str(basic.jobTitle),
          website: str(basic.website),
        }
      : undefined,
    company: str(card.company) ?? str(basic?.company),
    jobTitle: str(card.jobTitle) ?? str(basic?.jobTitle),
    email: str(card.email) ?? str(basic?.email),
    phone: str(card.phone) ?? str(basic?.phone),
    website: str(card.website),
    location: obj(card.location) as PublicCardDto['location'],
    businessHours: card.businessHours as PublicCardDto['businessHours'],
    sections: card.sections as Record<string, boolean> | undefined,
    config: obj(card.config) as CardRenderConfigDto | undefined,
    gallery: card.gallery as PublicCardDto['gallery'],
    galleryImages: card.galleryImages as PublicCardDto['galleryImages'],
    services: card.services as PublicCardDto['services'],
    urlAlias: str(card.urlAlias),
  };

  return pruneUndefined(dto as unknown as Record<string, unknown>) as PublicCardDto;
}
