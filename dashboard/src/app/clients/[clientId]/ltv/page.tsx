import { LtvClient } from "./ltv-client";

export default async function LtvPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <LtvClient clientId={clientId} />;
}
