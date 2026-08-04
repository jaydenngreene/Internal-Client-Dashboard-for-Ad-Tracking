import { Suspense } from "react";
import { AdBreakdownClient } from "./ad-breakdown-client";

export default async function AdBreakdownPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense>
      <AdBreakdownClient clientId={clientId} />
    </Suspense>
  );
}
