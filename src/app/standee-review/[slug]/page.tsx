import type { Metadata } from 'next';
import { connectDB } from '@/lib/db';
import { ReviewAssistantFlow } from '@/components/review/review-assistant';
import { COPY_FLOW_ACTIVE, REVIEW_ROTATION_ACTIVE } from '@/lib/review-feature-flags';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import AnalyticsLog from '@/models/AnalyticsLog';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  try {
    await connectDB();
    const host = await resolveStandeeReviewHost(params.slug);
    return host
      ? {
          title: `Leave a review for ${host.businessName}`,
          robots: { index: false, follow: false },
        }
      : { title: 'Review not available', robots: { index: false, follow: false } };
  } catch {
    return { title: 'Leave a review', robots: { index: false, follow: false } };
  }
}

function Unavailable() {
  return (
    <main className="vcard-root flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-[var(--v-text)]">
          Reviews aren’t available right now.
        </p>
      </div>
    </main>
  );
}

export default async function StandeeReviewPage({ params }: Params) {
  await connectDB();
  const host = await resolveStandeeReviewHost(params.slug);
  if (!host) return <Unavailable />;

  // Best-effort attribution for the new host. Metadata only — never review
  // text, tokens or private settings.
  await AnalyticsLog.create({
    action: 'review_page_view',
    standeeId: host.standeeId,
    metadata: `standee-review:${host.routeSlug}`,
  }).catch(() => undefined);

  return (
    <main className="vcard-root min-h-screen bg-[var(--v-bg)]">
      <ReviewAssistantFlow
        alias={host.routeSlug}
        apiBase={`/api/public/standee-reviews/${encodeURIComponent(host.routeSlug)}`}
        businessName={host.businessName}
        initials={host.initials}
        copyFlowEnabled={COPY_FLOW_ACTIVE}
        rotationEnabled={REVIEW_ROTATION_ACTIVE}
        trackPageView={false}
        config={{
          googleReviewUrl: host.config.googleReviewUrl,
          welcomeMessage: host.config.welcomeMessage ?? '',
          writingStyle: host.config.writingStyle,
          preferredLength: host.config.preferredLength,
          languages: host.languages,
          feedbackTopics: host.config.feedbackTopics,
          styleMode: host.config.styleMode,
          lengthMode: host.config.lengthMode,
        }}
      />
    </main>
  );
}
