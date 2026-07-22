import { InsightsClient } from "./insights-client";

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <InsightsClient clientId={clientId} />;
}
