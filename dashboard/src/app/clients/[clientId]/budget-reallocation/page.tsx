import { BudgetReallocationClient } from "./budget-reallocation-client";

export default async function BudgetReallocationPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <BudgetReallocationClient clientId={clientId} />;
}
