import { redirect } from "next/navigation";
import { PageHeader } from "@zmzai/theme";

import { RelayShell } from "@/components/relay-shell";
import { Pagination } from "@/components/pagination";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceLedgerModel } from "@/providers/database/mongodb/models/balance";
import { cnyMicrosLabel } from "@/providers/billing/currency";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
const PAGE_SIZE = 20;
const money = (value: number) => cnyMicrosLabel(value);
export const dynamic = "force-dynamic";

const kindLabel: Record<string, string> = {
  welcome_credit: "新人体验额度",
  purchase_credit: "充值到账",
  admin_credit: "管理员加款",
  admin_debit: "管理员扣减",
  usage_charge: "调用扣费",
  refund: "退款",
};

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard/ledger")}`);
  await connectMongo();
  const page = Math.max(1, Number(sp.page) || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const [total, ledger] = await Promise.all([
    BalanceLedgerModel.countDocuments({ userId: user.id }),
    BalanceLedgerModel.find({ userId: user.id }).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE).lean(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <RelayShell role="user" userName={user.name} isAdminUser={user.role === "admin"}>
      <PageHeader
        icon="receipt"
        eyebrow="控制台"
        title="账单"
        description="余额变动明细，按时间倒序分页展示。"
      />
      <div className="mt-6">
        {ledger.length ? (
          <div className="space-y-3">
            {ledger.map((item) => (
              <div
                key={String(item._id)}
                className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg p-4 transition-all duration-200 hover:border-line-strong hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{kindLabel[item.kind] ?? item.kind}</p>
                  <p className="mt-1.5 font-mono text-xs text-muted">{new Date(item.createdAt).toLocaleString("zh-CN")}</p>
                </div>
                <p
                  className={`shrink-0 font-mono text-sm font-medium ${
                    item.amountMicros >= 0 ? "text-success" : "text-danger"
                  }`}
                >
                  {item.amountMicros >= 0 ? "+" : ""}
                  {money(item.amountMicros)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <p className="text-sm text-muted">暂无账单记录。</p>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} basePath="/dashboard/ledger" />
      </div>
    </RelayShell>
  );
}
