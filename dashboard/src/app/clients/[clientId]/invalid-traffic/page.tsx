import { InvalidTrafficClient } from "./invalid-traffic-client";

export default async function InvalidTrafficPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <InvalidTrafficClient clientId={clientId} />;
}
