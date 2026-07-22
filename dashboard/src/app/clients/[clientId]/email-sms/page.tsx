import { EmailSmsClient } from "./email-sms-client";

export default async function EmailSmsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <EmailSmsClient clientId={clientId} />;
}
