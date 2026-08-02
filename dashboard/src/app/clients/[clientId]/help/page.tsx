import { Suspense } from "react";
import { HelpClient } from "./help-client";

export default async function HelpPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense>
      <HelpClient clientId={clientId} />
    </Suspense>
  );
}
