import { SubscriptionsClient } from "./subscriptions-client";

export default async function SubscriptionsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <SubscriptionsClient clientId={clientId} />;
}
