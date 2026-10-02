import { notFound, redirect } from 'next/navigation';
import { connectDB } from '@/lib/db';
import { getAuthUserForPage } from '@/lib/auth/capability-guard';
import { canEditCardExperience, getOwnedCard } from '@/lib/services/card-access';
import PageClient from './page-client';

export default async function VcardEditPageWrapper({ params }: { params: { id: string } }) {
  const user = await getAuthUserForPage();
  if (!user) redirect('/login');

  await connectDB();
  const result = await getOwnedCard(params.id, user);
  if (result.status === 'not_found') notFound();
  if (result.status === 'forbidden') redirect('/dashboard');

  if (!(await canEditCardExperience(user, result.card))) redirect('/dashboard');

  return <PageClient />;
}