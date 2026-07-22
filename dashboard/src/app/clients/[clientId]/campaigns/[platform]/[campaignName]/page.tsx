import { CampaignDetailClient } from "./campaign-detail-client";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; platform: string; campaignName: string }>;
}) {
  const { clientId, platform, campaignName } = await params;
  return (
    <CampaignDetailClient
      clientId={clientId}
      platform={decodeURIComponent(platform)}
      campaignName={decodeURIComponent(campaignName)}
    />
  );
}
