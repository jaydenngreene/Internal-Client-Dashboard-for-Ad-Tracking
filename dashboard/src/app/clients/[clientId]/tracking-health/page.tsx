import { TrackingHealthClient } from "./tracking-health-client";

export default async function TrackingHealthPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <TrackingHealthClient clientId={clientId} />;
}
