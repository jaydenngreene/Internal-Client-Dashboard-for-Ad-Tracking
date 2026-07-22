import { ShareReportClient } from "./share-report-client";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ShareReportClient token={decodeURIComponent(token)} />;
}
