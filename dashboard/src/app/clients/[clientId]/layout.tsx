import { RecentClientTracker } from "@/components/recent-client-tracker";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <>
      <RecentClientTracker clientId={clientId} />
      {children}
    </>
  );
}
