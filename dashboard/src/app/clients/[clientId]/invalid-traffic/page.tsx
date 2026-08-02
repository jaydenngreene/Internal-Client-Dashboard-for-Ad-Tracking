import { RouteRedirect } from "@/components/route-redirect";

export default async function InvalidTrafficPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RouteRedirect to={`/clients/${clientId}/recommendations?type=invalid-traffic`} />;
}
