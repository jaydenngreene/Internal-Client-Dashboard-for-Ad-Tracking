import { BofClient } from "./bof-client";

export default async function BofPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <BofClient clientId={clientId} />;
}
