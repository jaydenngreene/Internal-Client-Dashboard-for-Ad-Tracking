import { RouteRedirect } from "@/components/route-redirect";

export default async function BudgetReallocationPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <RouteRedirect to={`/clients/${clientId}/recommendations?type=budget-reallocation`} />;
}
