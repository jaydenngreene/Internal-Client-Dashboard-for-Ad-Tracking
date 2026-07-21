import { TagsClient } from "./tags-client";

export default async function TagsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <TagsClient clientId={clientId} />;
}
