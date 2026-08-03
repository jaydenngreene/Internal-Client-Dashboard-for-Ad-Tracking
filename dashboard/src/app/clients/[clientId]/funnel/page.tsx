import { Suspense } from "react";
import { FunnelClient } from "./funnel-client";

export default async function FunnelPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense>
      <FunnelClient clientId={clientId} />
    </Suspense>
  );
}
