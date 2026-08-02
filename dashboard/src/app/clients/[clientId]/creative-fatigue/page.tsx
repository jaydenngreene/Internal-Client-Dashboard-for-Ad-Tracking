import { RouteRedirect } from "@/components/route-redirect";

export default async function CreativeFatiguePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RouteRedirect to={`/clients/${clientId}/recommendations?type=creative-fatigue`} />;
}
