import { LeadsClient } from "./leads-client";

export default async function LeadsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <LeadsClient clientId={clientId} />;
}
