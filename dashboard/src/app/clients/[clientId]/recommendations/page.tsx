import { Suspense } from "react";
import { RecommendationsClient } from "./recommendations-client";

export default async function RecommendationsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense>
      <RecommendationsClient clientId={clientId} />
    </Suspense>
  );
}
