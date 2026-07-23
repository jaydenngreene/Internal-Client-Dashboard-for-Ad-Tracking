import { HelpClient } from "./help-client";

export default async function HelpPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <HelpClient clientId={clientId} />;
}
