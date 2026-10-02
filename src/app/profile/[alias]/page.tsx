import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { connectDB } from '@/lib/db';
import { resolvePublicCardProfile } from '@/lib/services/card-access';
import { PublicCardPage, buildPublicCardMetadata } from '@/components/public';
import type { ICard } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

const getCard = cache(async (alias: string) => {
  await connectDB();
  return resolvePublicCardProfile(alias) as unknown as Promise<
    | (Record<string, unknown> & { _id: unknown; userId: unknown })
    | null
  >;
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  try {
    const card = (await getCard(params.alias)) as unknown as ICard | null;
    return buildPublicCardMetadata(card);
  } catch {
    return { title: 'Digital Business Card' };
  }
}

export default async function ProfilePage({ params }: Params) {
  const raw = await getCard(params.alias);
  if (!raw) notFound();

  // Serialize to a plain object before it reaches any client component.
  // The raw mongoose document carries circular internals ($__/_doc/Collection)
  // that blow React's flight serializer when the whole vcard is forwarded to
  // client boundaries (StickyDock). toObject() yields a JSON-safe snapshot of
  // the exact same stored fields.
  const card = (raw as { toObject?: () => ICard }).toObject?.() ?? (raw as unknown as ICard);

  // Kind dispatch, feature gate, catalog + settings and themed rendering all
  // live in the shared PublicCardPage (also used by /{business}/{product}).
  return <PublicCardPage card={card} />;
}