import { CreativeFatigueClient } from "./creative-fatigue-client";

export default async function CreativeFatiguePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <CreativeFatigueClient clientId={clientId} />;
}
