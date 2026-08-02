import { RouteRedirect } from "@/components/route-redirect";

export default async function CreativePatternsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RouteRedirect to={`/clients/${clientId}/campaigns?view=creative`} />;
}
