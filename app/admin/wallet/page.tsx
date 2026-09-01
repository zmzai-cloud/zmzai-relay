import { redirect } from "next/navigation";
import { PageHeader } from "@zmzai/theme";

import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel } from "@/providers/database/mongodb/models/balance";
import { WalletPanel } from "./wallet-panel";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
export const dynamic = "force-dynamic";

export default async function WalletAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin/wallet")}`);
  if (user.role !== "admin") redirect("/dashboard");

  await connectMongo();
  const account = await BalanceAccountModel.findOne({ userId: user.id })
    .select("balanceMicros reservedMicros")
    .lean();

  return (
    <RelayShell role="admin" userName={user.name}>
      <PageHeader
        icon="wallet"
        eyebrow="管理后台"
        title="额度管理"
        description="从 admin 资金池划拨额度给其他账户，或直接授信补充任意账户（含自己）。每次操作都写入双向账本与审计日志。"
      />
      <div className="mt-8">
        <WalletPanel
          poolBalanceMicros={account?.balanceMicros ?? 0}
          poolReservedMicros={account?.reservedMicros ?? 0}
          me={{ id: user.id, name: user.name, email: user.email }}
        />
      </div>
    </RelayShell>
  );
}
