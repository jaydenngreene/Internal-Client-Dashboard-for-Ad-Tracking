import { AudiencesClient } from "./audiences-client";

export default async function AudiencesPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <AudiencesClient clientId={clientId} />;
}
