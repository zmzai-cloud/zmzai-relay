import { redirect } from "next/navigation";
import Link from "next/link";

import { Badge } from "@zmzai/theme";
import { RelayShell } from "@/components/relay-shell";
import { Pagination } from "@/components/pagination";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { UsageModel } from "@/providers/database/mongodb/models/usage";
import { cnyMicrosLabel } from "@/providers/billing/currency";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
const PAGE_SIZE = 20;
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

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard/activity")}`);
  await connectMongo();
  const page = Math.max(1, Number(sp.page) || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const [total, usages] = await Promise.all([
    UsageModel.countDocuments({ userId: user.id }),
    UsageModel.find({ userId: user.id }).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE).lean(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <RelayShell role="user" userName={user.name} isAdminUser={user.role === "admin"}>
      <h1 className="text-2xl font-semibold tracking-tight">用量</h1>
      <p className="mt-2 text-sm text-ink-2">调用记录与费用，按时间倒序分页展示。</p>
      <div className="mt-6">
        {usages.length ? (
          <div className="space-y-3">
            {usages.map((u) => (
              <div
                key={String(u._id)}
                className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg p-4 transition-all duration-200 hover:border-line-strong hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="truncate font-mono text-sm text-ink">{u.model}</span>
                    <Badge variant={statusVariant(u.status)} size="sm">{statusLabel(u.status)}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{new Date(u.createdAt).toLocaleString("zh-CN")}</p>
                  {u.lastError ? <p className="mt-1 text-[11px] text-danger">{u.lastError}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-medium text-ink">{money(u.chargedMicros)}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted">{u.totalTokens.toLocaleString()} tokens</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <p className="text-sm text-muted">
              还没有调用记录。创建{" "}
              <Link href="/dashboard/keys" className="text-accent underline underline-offset-4">
                API Key
              </Link>{" "}
              后即可开始调用。
            </p>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} basePath="/dashboard/activity" />
      </div>
    </RelayShell>
  );
}
