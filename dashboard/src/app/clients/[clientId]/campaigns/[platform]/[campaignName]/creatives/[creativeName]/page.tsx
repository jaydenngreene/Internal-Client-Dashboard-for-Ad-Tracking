import { CreativeDetailClient } from "./creative-detail-client";

export default async function CreativeDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; platform: string; campaignName: string; creativeName: string }>;
}) {
  const { clientId, platform, campaignName, creativeName } = await params;
  return (
    <CreativeDetailClient
      clientId={clientId}
      platform={decodeURIComponent(platform)}
      campaignName={decodeURIComponent(campaignName)}
      creativeName={decodeURIComponent(creativeName)}
    />
  );
}
