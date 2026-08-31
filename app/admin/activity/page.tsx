import { redirect } from "next/navigation";
import { Badge, PageHeader } from "@zmzai/theme";
import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceLedgerModel } from "@/providers/database/mongodb/models/balance";
import { ChannelAttemptModel } from "@/providers/database/mongodb/models/channel-attempt";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { UsageModel } from "@/providers/database/mongodb/models/usage";
import { cnyMicrosLabel } from "@/providers/billing/currency";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
const money = (value: number) => cnyMicrosLabel(value);
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
const kindLabel: Record<string, string> = {
  welcome_credit: "新人体验额度",
  purchase_credit: "充值到账",
  admin_credit: "管理员加款",
  admin_debit: "管理员扣减",
  usage_charge: "调用扣费",
  refund: "退款",
};
export const dynamic = "force-dynamic";
export default async function ActivityPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin/activity")}`);
  if (user.role !== "admin") redirect("/dashboard");
  await connectMongo();
  const [usages, ledger, uncertain, uncertainSummary] = await Promise.all([
      UsageModel.find().sort({ createdAt: -1 }).limit(80).lean(),
      BalanceLedgerModel.find().sort({ createdAt: -1 }).limit(80).lean(),
      ChannelAttemptModel.countDocuments({ costStatus: "unknown" }),
      // 待核查成本聚合：completed+unknown 是真实发生但未记成本的上游支出；
      // failed+unknown 是网络异常中断（无成本），两者分开列便于运营核查。
      ChannelAttemptModel.aggregate<{ _id: { channelId: unknown; status: string; upstreamModel: string }; count: number; firstAt: Date; lastAt: Date }>([
        { $match: { costStatus: "unknown" } },
        { $group: { _id: { channelId: "$channelId", status: "$status", upstreamModel: "$upstreamModel" }, count: { $sum: 1 }, firstAt: { $min: "$createdAt" }, lastAt: { $max: "$createdAt" } } },
        { $sort: { count: -1 } },
        { $limit: 30 },
      ]),
    ]);
    const recentUnknown = await ChannelAttemptModel.find({ costStatus: "unknown" }).sort({ createdAt: -1 }).limit(20).lean();
    const [unknownUsages, unknownChannels] = await Promise.all([
      UsageModel.find({ _id: { $in: recentUnknown.map((attempt) => attempt.usageId) } }).select("model chargedMicros totalTokens status").lean(),
      ChannelModel.find({ _id: { $in: [...new Set(uncertainSummary.map((row) => String(row._id.channelId)))] } }).select("name").lean(),
    ]);
    const unknownUsageMap = new Map(unknownUsages.map((item) => [String(item._id), item]));
    const channelNameMap = new Map(unknownChannels.map((channel) => [String(channel._id), channel.name]));
  const attempts = await ChannelAttemptModel.find({ usageId: { $in: usages.map((item) => item._id) } }).sort({ createdAt: -1 }).lean();
  const attemptsByUsage = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const key = String(attempt.usageId);
    const current = attemptsByUsage.get(key) ?? [];
    current.push(attempt);
    attemptsByUsage.set(key, current);
  }
  return (
    <RelayShell role="admin" userName={user.name}>
      <PageHeader
        icon="activity"
        eyebrow="管理后台"
        title="调用与账本"
        description={
          <>
            全站最近的调用、渠道尝试与余额流水。待核查上游成本：{uncertain} 笔。
          </>
        }
      />
      {uncertain > 0 ? (
        <div className="mt-4 rounded-lg border border-line">
          <div className="border-b border-line bg-surface px-4 py-2.5">
            <h2 className="text-sm font-semibold">待核查成本构成（按渠道 / 状态 / 上游模型聚合）</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
                  <th className="px-4 py-2 font-normal">渠道</th>
                  <th className="px-4 py-2 font-normal">状态</th>
                  <th className="px-4 py-2 font-normal">上游模型</th>
                  <th className="px-4 py-2 text-right font-normal">笔数</th>
                  <th className="px-4 py-2 text-right font-normal">最早</th>
                  <th className="px-4 py-2 text-right font-normal">最近</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {uncertainSummary.map((row) => (
                  <tr key={`${String(row._id.channelId)}-${row._id.status}-${row._id.upstreamModel}`}>
                    <td className="px-4 py-2 font-mono text-xs">{channelNameMap.get(String(row._id.channelId)) ?? String(row._id.channelId).slice(0, 8)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{row._id.status === "completed" ? "成功（有上游支出）" : "失败（网络中断）"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{row._id.upstreamModel}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{row.count}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px] text-muted">{new Date(row.firstAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px] text-muted">{new Date(row.lastAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <h3 className="text-xs font-semibold text-muted">最近 {recentUnknown.length} 笔（completed 为真实成本缺口，failed 为网络中断无成本）</h3>
            {recentUnknown.map((attempt) => {
              const usage = unknownUsageMap.get(String(attempt.usageId));
              return (
                <p key={String(attempt._id)} className="mt-1 font-mono text-[11px] text-muted">
                  {new Date(attempt.createdAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })} · {channelNameMap.get(String(attempt.channelId)) ?? "?"} · {attempt.upstreamModel} · {attempt.status} · {attempt.latencyMs}ms{usage ? ` · ${usage.model} · 收取 ${money(usage.chargedMicros)}` : ""}{attempt.error ? ` · ${attempt.error.slice(0, 80)}` : ""}
                </p>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:items-start">
        <div>
          <h2 className="mb-3 text-lg font-semibold">调用</h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
                  <th className="px-4 py-2.5 font-normal">模型</th>
                  <th className="px-4 py-2.5 font-normal">状态</th>
                  <th className="px-4 py-2.5 text-right font-normal">Tokens</th>
                  <th className="px-4 py-2.5 text-right font-normal">费用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {usages.map((item) => {
                  const itemAttempts = attemptsByUsage.get(String(item._id)) ?? [];
                  return (
                    <tr key={String(item._id)} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs">{item.model}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted">{item.requestId} · → {item.upstreamModel}</p>
                        {item.lastError ? <p className="mt-0.5 text-[11px] text-danger">{item.lastError}</p> : null}
                        {itemAttempts.map((attempt) => (
                          <p key={String(attempt._id)} className="mt-0.5 font-mono text-[11px] text-muted">
                            渠道尝试 · {attempt.status} · {attempt.latencyMs}ms{attempt.error ? ` · ${attempt.error}` : ""}
                          </p>
                        ))}
                      </td>
                      <td className="px-4 py-3"><Badge variant={statusVariant(item.status)} size="sm">{statusLabel(item.status)}</Badge></td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted">{item.totalTokens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{money(item.chargedMicros)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">账本</h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
                  <th className="px-4 py-2.5 font-normal">类型</th>
                  <th className="px-4 py-2.5 text-right font-normal">金额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ledger.map((item) => (
                  <tr key={String(item._id)}>
                    <td className="px-4 py-3">
                      <p className="text-xs">{kindLabel[item.kind] ?? item.kind}</p>
                      <p className="font-mono text-[11px] text-muted">{new Date(item.createdAt).toLocaleString("zh-CN")}</p>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${item.amountMicros >= 0 ? "" : "text-danger"}`}>{money(item.amountMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RelayShell>
  );
}
