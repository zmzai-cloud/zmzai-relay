import { redirect } from "next/navigation";
import { PageHeader } from "@zmzai/theme";

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
      <PageHeader
        icon="sliders"
        eyebrow="管理后台"
        title="运营调整"
        description="人工维护模型价目与用户余额，每次调整都会写入账本。"
      />
      <div className="mt-8"><OperationsPanel /></div>
    </RelayShell>
  );
}
