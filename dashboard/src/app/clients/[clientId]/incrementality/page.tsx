import { IncrementalityClient } from "./incrementality-client";

export default async function IncrementalityPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <IncrementalityClient clientId={clientId} />;
}
