import { ChatClient } from "./chat-client";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ChatClient clientId={clientId} />;
}
