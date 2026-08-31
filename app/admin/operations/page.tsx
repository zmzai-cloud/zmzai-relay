import { redirect } from "next/navigation";

import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { OperationsPanel } from "../operations-panel";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin/operations")}`);
  if (user.role !== "admin") redirect("/dashboard");
  return (
    <RelayShell role="admin" userName={user.name}>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">运营调整</h1>
      <p className="mt-2 text-sm text-ink-2">人工维护模型价目与用户余额，每次调整都会写入账本。</p>
      <div className="mt-8"><OperationsPanel /></div>
    </RelayShell>
  );
}
