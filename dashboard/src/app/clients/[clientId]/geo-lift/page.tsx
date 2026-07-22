import { GeoLiftClient } from "./geo-lift-client";

export default async function GeoLiftPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <GeoLiftClient clientId={clientId} />;
}
