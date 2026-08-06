import { Suspense } from "react";
import { FullReportClient } from "./full-report-client";

export default async function FullReportPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense>
      <FullReportClient clientId={clientId} />
    </Suspense>
  );
}
