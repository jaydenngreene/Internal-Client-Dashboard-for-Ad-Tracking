import { MmmClient } from "./mmm-client";

export default async function MmmPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <MmmClient clientId={clientId} />;
}
