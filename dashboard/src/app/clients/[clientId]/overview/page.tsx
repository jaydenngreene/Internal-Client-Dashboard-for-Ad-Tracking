import { OverviewClient } from "./overview-client";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <OverviewClient clientId={clientId} />;
}
