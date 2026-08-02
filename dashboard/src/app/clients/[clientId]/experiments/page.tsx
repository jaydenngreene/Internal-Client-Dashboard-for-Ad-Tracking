import { Suspense } from "react";
import { ExperimentsClient } from "./experiments-client";

export default async function ExperimentsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense>
      <ExperimentsClient clientId={clientId} />
    </Suspense>
  );
}
