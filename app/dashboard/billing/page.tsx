import { redirect } from "next/navigation";

import { BillingPanel } from "@/components/billing-panel";
import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel } from "@/providers/database/mongodb/models/balance";
import { ensureWelcomeCredit } from "@/providers/billing/onboarding";
import { getWalletProducts } from "@/providers/billing/wallet-products";
import { cnyMicrosLabel } from "@/providers/billing/currency";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard/billing")}`);
  await connectMongo();
  await ensureWelcomeCredit(user.id);
  const account = await BalanceAccountModel.findOne({ userId: user.id }).lean();
  const products = getWalletProducts();
  const availableMicros = Math.max(0, (account?.balanceMicros ?? 0) - (account?.reservedMicros ?? 0));
  const steps: Array<[string, string]> = [
    ["选择额度包，点击「申请充值」", "系统生成一个 5 分钟内有效的申请码。"],
    ["把申请码发送给管理员", "在微信里把码发给管理员，并说明需要的额度包。"],
    ["管理员确认后自动到账", "管理员核对收款后在后台确认，额度即时写入你的钱包。"],
  ];
  return (
    <RelayShell role="user" userName={user.name} isAdminUser={user.role === "admin"}>
      <h1 className="text-2xl font-semibold tracking-tight">额度充值</h1>
      <p className="mt-2 text-sm text-ink-2">余额按调用实际用量扣减。首次进入会自动获得 ¥1 体验额度。</p>

      <div className="mt-6 flex items-center justify-between gap-6 rounded-xl border border-line bg-bg p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">当前可用余额</p>
          <p className="mt-2 font-mono text-4xl font-semibold tracking-tight text-ink">{cnyMicrosLabel(availableMicros)}</p>
        </div>
        {account ? (
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted">总余额 / 已预留</p>
            <p className="mt-1 font-mono text-sm text-ink-2">
              {cnyMicrosLabel(account.balanceMicros ?? 0)} / {cnyMicrosLabel(account.reservedMicros ?? 0)}
            </p>
          </div>
        ) : null}
      </div>

      <h2 className="mt-10 text-lg font-semibold">充值流程</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {steps.map(([title, description], index) => (
          <div key={title} className="rounded-xl border border-line bg-bg p-5">
            <p className="font-mono text-xs text-muted">{String(index + 1).padStart(2, "0")}</p>
            <p className="mt-2 text-sm font-medium text-ink">{title}</p>
            <p className="mt-1.5 text-xs leading-5 text-muted">{description}</p>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <BillingPanel products={products} />
      </div>
    </RelayShell>
  );
}
