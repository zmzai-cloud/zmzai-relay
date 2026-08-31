import { redirect } from "next/navigation";
import { Badge } from "@zmzai/theme";
import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { ChannelAttemptModel } from "@/providers/database/mongodb/models/channel-attempt";
import { UsageModel } from "@/providers/database/mongodb/models/usage";
import { cnyMicrosLabel } from "@/providers/billing/currency";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
const money = (value: number) => cnyMicrosLabel(value, 2);
export const dynamic = "force-dynamic";

interface UsageWindow { requests: number; completed: number; revenue: number; cost: number; }
const emptyWindow = (): UsageWindow => ({ requests: 0, completed: 0, revenue: 0, cost: 0 });

/** 请求窗口聚合：completed 计成功与收入/成本，failed/unsettled 只计请求总数（成功率分母）。 */
function usageWindow(since: Date) {
  return UsageModel.aggregate([
    { $match: { createdAt: { $gte: since }, status: { $in: ["completed", "unsettled", "failed"] } } },
    { $group: {
      _id: null,
      requests: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
      revenue: { $sum: "$chargedMicros" },
      cost: { $sum: "$costMicros" },
    } },
  ]).then((rows) => (rows[0] as UsageWindow | undefined) ?? emptyWindow());
}

const successRate = (w: UsageWindow) => (w.requests === 0 ? null : Math.round((w.completed / w.requests) * 1000) / 10);
const profitMargin = (w: UsageWindow) => (w.revenue === 0 ? null : Math.round(((w.revenue - w.cost) / w.revenue) * 1000) / 10);

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin")}`);
  if (user.role !== "admin") redirect("/dashboard");
  await connectMongo();
  const since24h = new Date(Date.now() - 86400000);
  const since7d = new Date(Date.now() - 7 * 86400000);
  const [day, week, channels, attemptRows] = await Promise.all([
    usageWindow(since24h),
    usageWindow(since7d),
    ChannelModel.find().sort({ priority: 1 }).lean(),
    // 渠道健康：最近 24h 每渠道调用数/成功率/平均延迟 + 最近一条失败原因
    ChannelAttemptModel.aggregate([
      { $match: { createdAt: { $gte: since24h } } },
      { $sort: { createdAt: -1 } },
      { $group: {
        _id: "$channelId",
        attempts: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        avgLatency: { $avg: "$latencyMs" },
        lastError: { $first: "$error" },
        lastAt: { $first: "$createdAt" },
      } },
    ]),
  ]);
  const attemptByChannel = new Map(attemptRows.map((row) => [String(row._id), row]));
  const now = Date.now();

  const stats: Array<[string, string, string, "danger" | null]> = [
    ["24h 请求", day.requests.toLocaleString(), `成功率 ${successRate(day) === null ? "—" : `${successRate(day)}%`}`, null],
    ["24h 毛利", money(day.revenue - day.cost), `收入 ${money(day.revenue)} · 毛利率 ${profitMargin(day) === null ? "—" : `${profitMargin(day)}%`}`, day.revenue - day.cost < 0 ? "danger" : null],
    ["7 天毛利", money(week.revenue - week.cost), `收入 ${money(week.revenue)} · 毛利率 ${profitMargin(week) === null ? "—" : `${profitMargin(week)}%`}`, week.revenue - week.cost < 0 ? "danger" : null],
    ["7 天请求", week.requests.toLocaleString(), `成功率 ${successRate(week) === null ? "—" : `${successRate(week)}%`}`, null],
  ];
  return (
    <RelayShell role="admin" userName={user.name}>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">运营概览</h1>
      <p className="mt-2 text-sm text-ink-2">调用、毛利与渠道健康度总览；毛利 = 收入 − 上游成本（成本未配置的渠道不计入）。</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(([label, value, hint, danger]) => (
          <div key={label} className="rounded-lg border border-line bg-bg p-5">
            <p className="font-mono text-xs text-muted">{label}</p>
            <p className={`mt-2 font-mono text-2xl ${danger === "danger" ? "text-danger" : ""}`}>{value}</p>
            <p className="mt-1 text-xs text-muted">{hint}</p>
          </div>
        ))}
      </div>
      <h2 className="mt-10 text-lg font-semibold">渠道健康度</h2>
      <p className="mt-1 text-xs text-muted">统计窗口为最近 24 小时；连续失败 3 次的渠道自动冷却 5 分钟，手动测试推理成功可解除。</p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">渠道</th>
              <th className="px-4 py-2.5 font-normal">状态</th>
              <th className="px-4 py-2.5 font-normal">优先级</th>
              <th className="px-4 py-2.5 font-normal">24h 调用</th>
              <th className="px-4 py-2.5 font-normal">成功率</th>
              <th className="px-4 py-2.5 font-normal">平均延迟</th>
              <th className="px-4 py-2.5 font-normal">最近失败</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {channels.map((channel) => {
              const row = attemptByChannel.get(String(channel._id));
              const attempts = row?.attempts ?? 0;
              const rate = attempts === 0 ? null : Math.round(((row?.completed ?? 0) / attempts) * 100);
              const cooling = channel.cooldownUntil ? new Date(channel.cooldownUntil).getTime() > now : false;
              const degraded = rate !== null && rate < 90 && attempts >= 5;
              return (
                <tr key={String(channel._id)} className={degraded ? "bg-danger/5" : undefined}>
                  <td className="px-4 py-3 font-medium">{channel.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant={channel.enabled ? "success" : "outline"} size="sm">{channel.enabled ? "启用" : "停用"}</Badge>
                    {cooling ? <span className="ml-1.5"><Badge variant="warning" size="sm">冷却中</Badge></span> : null}
                    {!cooling && (channel.consecutiveFailures ?? 0) > 0 ? <span className="ml-1.5"><Badge variant="warning" size="sm">失败 {channel.consecutiveFailures}</Badge></span> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">P{channel.priority}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{attempts === 0 ? "—" : attempts}</td>
                  <td className={`px-4 py-3 font-mono text-xs ${degraded ? "font-medium text-danger" : "text-muted"}`}>{rate === null ? "—" : `${rate}%`}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{attempts === 0 ? "—" : `${Math.round(row?.avgLatency ?? 0)}ms`}</td>
                  <td className="max-w-[16rem] truncate px-4 py-3 font-mono text-xs text-muted" title={row && (row.completed ?? 0) < attempts ? String(row.lastError ?? "") : undefined}>
                    {row && (row.completed ?? 0) < attempts ? String(row.lastError ?? "—") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </RelayShell>
  );
}
