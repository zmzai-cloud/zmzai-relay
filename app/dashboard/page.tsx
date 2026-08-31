import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@zmzai/theme";
import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel } from "@/providers/database/mongodb/models/balance";
import { UsageModel } from "@/providers/database/mongodb/models/usage";
import { cnyMicrosLabel } from "@/providers/billing/currency";
import { ensureWelcomeCredit } from "@/providers/billing/onboarding";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
const money = (value: number) => cnyMicrosLabel(value);
export const dynamic = "force-dynamic";

const statusVariant = (status: string): "success" | "danger" | "warning" | "outline" => {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "unsettled") return "warning";
  return "outline";
};
const statusLabel = (status: string): string => {
  if (status === "completed") return "成功";
  if (status === "failed") return "失败";
  if (status === "unsettled") return "待结算";
  return status;
};

function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`;
  if (diffMins < 43200) return `${Math.floor(diffMins / 1440)} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard")}`);
  await connectMongo();
  await ensureWelcomeCredit(user.id);
  const [account, usage] = await Promise.all([BalanceAccountModel.findOne({ userId: user.id }).lean(), UsageModel.find({ userId: user.id }).sort({ createdAt: -1 }).limit(8).lean()]);
  const charged = usage.reduce((sum, item) => sum + item.chargedMicros, 0);
  const success = usage.filter((item) => item.status === "completed").length;
  const availableMicros = Math.max(0, (account?.balanceMicros ?? 0) - (account?.reservedMicros ?? 0));
  const stats: Array<[string, string, string]> = [
    ["可用余额", money(availableMicros), "随每次调用扣减"],
    ["近期消费", money(charged), `最近 ${usage.length} 笔调用`],
    ["近期成功率", usage.length ? `${Math.round((success / usage.length) * 100)}%` : "-", `${success} / ${usage.length} 笔成功`],
  ];
  return (
    <RelayShell role="user" userName={user.name} isAdminUser={user.role === "admin"}>
      <h1 className="text-2xl font-semibold tracking-tight">概览</h1>
      <p className="mt-2 text-sm text-ink-2">余额、消费与最近调用。</p>

      {availableMicros === 0 ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-ink-2">
            当前账户余额已用尽。
            <Link href="/dashboard/billing" className="ml-1 font-medium text-accent underline underline-offset-4">去充值</Link>
          </p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border border-line bg-bg p-5 transition-colors hover:border-line-strong hover:shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
            <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-ink">{value}</p>
            <p className="mt-2 text-xs text-muted">{hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-9">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">最近调用</h2>
          <Link href="/dashboard/activity" className="font-mono text-xs text-muted hover:text-accent">全部记录 →</Link>
        </div>
        {usage.length ? (
          <div className="space-y-3">
            {usage.map((item) => (
              <div
                key={String(item._id)}
                className="group flex items-center justify-between gap-4 rounded-xl border border-line bg-bg p-4 transition-all duration-200 hover:border-line-strong hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="truncate font-mono text-sm text-ink">{item.model}</span>
                    <Badge variant={statusVariant(item.status)} size="sm">{statusLabel(item.status)}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{formatRelative(item.createdAt)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-medium text-ink">{money(item.chargedMicros)}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted">{item.totalTokens.toLocaleString()} tokens</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <p className="text-sm text-muted">
              还没有调用记录。创建 <Link href="/dashboard/keys" className="text-accent underline underline-offset-4">API Key</Link> 后即可开始调用。
            </p>
          </div>
        )}
      </div>
    </RelayShell>
  );
}
