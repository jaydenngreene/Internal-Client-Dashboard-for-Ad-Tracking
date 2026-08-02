import { RouteRedirect } from "@/components/route-redirect";

export default async function IncrementalityPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RouteRedirect to={`/clients/${clientId}/experiments?type=incrementality`} />;
}
