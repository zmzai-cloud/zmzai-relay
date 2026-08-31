import { redirect } from "next/navigation";
import { Badge } from "@zmzai/theme";
import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel } from "@/providers/database/mongodb/models/balance";
import { ApiKeyModel } from "@/providers/database/mongodb/models/apikey";
import { UserModel } from "@zmzai/db";
import { cnyMicrosLabel } from "@/providers/billing/currency";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
const money = (value: number) => cnyMicrosLabel(value);
export const dynamic = "force-dynamic";
export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin/users")}`);
  if (user.role !== "admin") redirect("/dashboard");
  await connectMongo();
  const [users, accounts, keys] = await Promise.all([UserModel.find().sort({ createdAt: -1 }).lean(), BalanceAccountModel.find().lean(), ApiKeyModel.find().lean()]);
  return (
    <RelayShell role="admin" userName={user.name}>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">用户与余额</h1>
      <p className="mt-2 text-sm text-ink-2">全部账号的余额与 API Key 情况。调整余额请到「运营调整」。</p>
      <div className="mt-6 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">用户</th>
              <th className="px-4 py-2.5 text-right font-normal">可用余额</th>
              <th className="px-4 py-2.5 text-right font-normal">活跃 Key</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((accountUser) => {
              const account = accounts.find((item) => String(item.userId) === String(accountUser._id));
              const tokenCount = keys.filter((key) => String(key.userId) === String(accountUser._id) && key.status === "active").length;
              const availableMicros = Math.max(0, (account?.balanceMicros ?? 0) - (account?.reservedMicros ?? 0));
              return (
                <tr key={String(accountUser._id)}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{accountUser.name}</p>
                    <p className="font-mono text-xs text-muted">{accountUser.email}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Badge variant={availableMicros > 0 ? "success" : "outline"} size="sm" className="font-mono">{money(availableMicros)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted">{tokenCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </RelayShell>
  );
}
