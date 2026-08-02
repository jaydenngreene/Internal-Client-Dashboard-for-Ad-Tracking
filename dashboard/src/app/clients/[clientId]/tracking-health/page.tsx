import { RouteRedirect } from "@/components/route-redirect";

export default async function TrackingHealthPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RouteRedirect to={`/clients/${clientId}/recommendations?type=tracking-health`} />;
}
