import { PauseCandidatesClient } from "./pause-candidates-client";

export default async function PauseCandidatesPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <PauseCandidatesClient clientId={clientId} />;
}
