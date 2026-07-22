import { Suspense } from "react";
import { LeadsClient } from "./leads-client";

export default async function LeadsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense>
      <LeadsClient clientId={clientId} />
    </Suspense>
  );
}
