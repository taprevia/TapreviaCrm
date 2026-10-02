import { connectDB } from '@/lib/db';
import Profile from '@/models/Profile';
import { DEFAULT_ALLOWED_TEMPLATES, isRegisteredTemplate } from '@/lib/card-templates';

/**
 * Resolve the set of card templates a user may select.
 * Explicit Profile.allowedTemplates wins; otherwise the code-level
 * defaults apply so existing customers are unaffected.
 */
export async function availableTemplatesForUser(
  userId: string | undefined | null
): Promise<string[]> {
  if (!userId) return [...DEFAULT_ALLOWED_TEMPLATES];

  await connectDB();
  const profile = (await Profile.findOne({ userId }).lean()) as
    | { allowedTemplates?: string[] }
    | null;
  const allowed = profile?.allowedTemplates;
  if (!Array.isArray(allowed) || allowed.length === 0) return [...DEFAULT_ALLOWED_TEMPLATES];

  const registered = allowed.filter((key): key is string => isRegisteredTemplate(key));
  return registered.length > 0 ? registered : [...DEFAULT_ALLOWED_TEMPLATES];
}