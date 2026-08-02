import { RouteRedirect } from "@/components/route-redirect";

export default async function PauseCandidatesPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RouteRedirect to={`/clients/${clientId}/recommendations?type=pause-candidates`} />;
}
