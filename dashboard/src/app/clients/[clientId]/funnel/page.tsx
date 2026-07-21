import { FunnelClient } from "./funnel-client";

export default async function FunnelPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <FunnelClient clientId={clientId} />;
}
