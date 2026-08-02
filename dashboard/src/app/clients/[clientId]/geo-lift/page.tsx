import { RouteRedirect } from "@/components/route-redirect";

export default async function GeoLiftPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RouteRedirect to={`/clients/${clientId}/experiments?type=geo-lift`} />;
}
