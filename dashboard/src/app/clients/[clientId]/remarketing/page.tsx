import { RemarketingClient } from "./remarketing-client";

export default async function RemarketingPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RemarketingClient clientId={clientId} />;
}
