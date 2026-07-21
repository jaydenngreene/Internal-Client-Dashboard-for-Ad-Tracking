import { redirect } from "next/navigation";
import { getClients } from "@/lib/api";

export default async function HomePage() {
  const clients = await getClients().catch(() => []);

  if (clients.length > 0) {
    redirect("/agency");
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-lg font-medium text-foreground">No clients yet</p>
      <p className="text-sm text-muted-foreground">
        Create a client via the API (<code className="rounded bg-muted px-1 py-0.5">POST /clients</code>)
        or one of the setup scripts to get started.
      </p>
    </div>
  );
}
