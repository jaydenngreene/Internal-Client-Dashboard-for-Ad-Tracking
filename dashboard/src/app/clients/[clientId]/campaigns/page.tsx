import { Suspense } from "react";
import { CampaignsClient } from "./campaigns-client";

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense>
      <CampaignsClient clientId={clientId} />
    </Suspense>
  );
}
