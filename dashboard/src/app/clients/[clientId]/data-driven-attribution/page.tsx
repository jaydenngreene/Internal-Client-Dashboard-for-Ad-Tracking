import { MarkovAttributionClient } from "./markov-attribution-client";

export default async function DataDrivenAttributionPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <MarkovAttributionClient clientId={clientId} />;
}
