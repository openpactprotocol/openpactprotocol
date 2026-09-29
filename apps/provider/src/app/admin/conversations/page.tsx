import type { ReactElement } from "react";
import AdminPage from "../page.js";

export const dynamic = "force-dynamic";

export default function AdminConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; pa_platform?: string }>;
}): Promise<ReactElement> {
  return AdminPage({ searchParams });
}
