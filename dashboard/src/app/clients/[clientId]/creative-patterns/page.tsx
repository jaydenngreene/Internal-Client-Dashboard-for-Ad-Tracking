import { CreativePatternsClient } from "./creative-patterns-client";

export default async function CreativePatternsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <CreativePatternsClient clientId={clientId} />;
}
