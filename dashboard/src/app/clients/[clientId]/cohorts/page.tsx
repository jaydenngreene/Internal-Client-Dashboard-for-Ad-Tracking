import { CohortsClient } from "./cohorts-client";

export default async function CohortsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <CohortsClient clientId={clientId} />;
}
