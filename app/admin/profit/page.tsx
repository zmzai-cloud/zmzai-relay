import Link from "next/link";
import { PageHeader } from "@zmzai/theme";
import { redirect } from "next/navigation";
import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { UsageModel } from "@/providers/database/mongodb/models/usage";
import { cnyMicrosLabel } from "@/providers/billing/currency";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
const money = (value: number) => cnyMicrosLabel(value);

interface AggRow {
  calls: number;
  tokens: number;
  revenueMicros: number;
  costMicros: number;
  profitMicros: number;
}

const emptyTotals: AggRow = { calls: 0, tokens: 0, revenueMicros: 0, costMicros: 0, profitMicros: 0 };

export const dynamic = "force-dynamic";

export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin/profit")}`);
  if (user.role !== "admin") redirect("/dashboard");
  const sp = await searchParams;
  const days = sp.days === "30" ? 30 : 7;
  await connectMongo();
  // 统计口径：completed + unsettled（真实发生的计费调用），排除失败/进行中
  const since = new Date(Date.now() - days * 86_400_000);
  const match = { createdAt: { $gte: since }, status: { $in: ["completed", "unsettled"] } };
  const [byModel, byChannel] = await Promise.all([
    UsageModel.aggregate<{ _id: string } & AggRow>([
      { $match: match },
      {
        $group: {
          _id: "$model",
          calls: { $sum: 1 },
          tokens: { $sum: "$totalTokens" },
          revenueMicros: { $sum: "$chargedMicros" },
          costMicros: { $sum: "$costMicros" },
          profitMicros: { $sum: "$grossProfitMicros" },
        },
      },
      { $sort: { profitMicros: -1 } },
    ]),
    UsageModel.aggregate<{ _id: unknown } & AggRow>([
      { $match: { ...match, channelId: { $ne: null } } },
      {
        $group: {
          _id: "$channelId",
          calls: { $sum: 1 },
          tokens: { $sum: "$totalTokens" },
          revenueMicros: { $sum: "$chargedMicros" },
          costMicros: { $sum: "$costMicros" },
          profitMicros: { $sum: "$grossProfitMicros" },
        },
      },
      { $sort: { profitMicros: -1 } },
    ]),
  ]);
  const channels = await ChannelModel.find({ _id: { $in: byChannel.map((row) => row._id) } })
    .select("name")
    .lean();
  const channelName = new Map(channels.map((c) => [String(c._id), c.name]));
  const totals = byModel.reduce(
    (acc, row) => ({
      calls: acc.calls + row.calls,
      tokens: acc.tokens + row.tokens,
      revenueMicros: acc.revenueMicros + row.revenueMicros,
      costMicros: acc.costMicros + row.costMicros,
      profitMicros: acc.profitMicros + row.profitMicros,
    }),
    emptyTotals,
  );
  const margin = totals.revenueMicros > 0 ? (totals.profitMicros / totals.revenueMicros) * 100 : null;
  const pct = (profit: number, revenue: number) => (revenue > 0 ? ((profit / revenue) * 100).toFixed(1) + "%" : "—");
  const profitClass = (value: number) => (value >= 0 ? "text-success" : "text-danger");
  return (
    <RelayShell role="admin" userName={user.name}>
      <PageHeader
        icon="trend-up"
        eyebrow="管理后台"
        title="毛利报表"
        description={
          <>
            按模型 / 渠道聚合的收入、成本与毛利。统计口径：最近 {days} 天内的成功与待结算调用。
          </>
        }
      />
      <div className="mt-4 flex items-center gap-1 font-mono text-xs">
        {[7, 30].map((d) => (
          <Link
            key={d}
            href={`/admin/profit?days=${d}`}
            className={`rounded-md px-2.5 py-1 transition-colors ${days === d ? "bg-accent/10 text-accent" : "text-muted hover:text-accent"}`}
          >
            最近 {d} 天
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">收入</p>
          <p className="mt-1 font-mono text-xl">{money(totals.revenueMicros)}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">成本</p>
          <p className="mt-1 font-mono text-xl">{money(totals.costMicros)}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">毛利</p>
          <p className={`mt-1 font-mono text-xl ${profitClass(totals.profitMicros)}`}>{money(totals.profitMicros)}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">毛利率</p>
          <p className={`mt-1 font-mono text-xl ${totals.profitMicros >= 0 ? "text-success" : "text-danger"}`}>{margin === null ? "—" : margin.toFixed(1) + "%"}</p>
        </div>
      </div>
      <div className="mt-6 grid gap-8 xl:grid-cols-2 xl:items-start">
        <div>
          <h2 className="mb-3 text-lg font-semibold">按模型</h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
                  <th className="px-4 py-2.5 font-normal">模型</th>
                  <th className="px-4 py-2.5 text-right font-normal">调用</th>
                  <th className="px-4 py-2.5 text-right font-normal">Tokens</th>
                  <th className="px-4 py-2.5 text-right font-normal">收入</th>
                  <th className="px-4 py-2.5 text-right font-normal">成本</th>
                  <th className="px-4 py-2.5 text-right font-normal">毛利</th>
                  <th className="px-4 py-2.5 text-right font-normal">毛利率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byModel.map((row) => (
                  <tr key={row._id}>
                    <td className="px-4 py-3 font-mono text-xs">{row._id}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted">{row.calls.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted">{row.tokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{money(row.revenueMicros)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted">{money(row.costMicros)}</td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${profitClass(row.profitMicros)}`}>{money(row.profitMicros)}</td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${profitClass(row.profitMicros)}`}>{pct(row.profitMicros, row.revenueMicros)}</td>
                  </tr>
                ))}
                {byModel.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center font-mono text-xs text-muted">
                      该时间段内暂无计费调用
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">按渠道</h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
                  <th className="px-4 py-2.5 font-normal">渠道</th>
                  <th className="px-4 py-2.5 text-right font-normal">调用</th>
                  <th className="px-4 py-2.5 text-right font-normal">收入</th>
                  <th className="px-4 py-2.5 text-right font-normal">成本</th>
                  <th className="px-4 py-2.5 text-right font-normal">毛利</th>
                  <th className="px-4 py-2.5 text-right font-normal">毛利率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byChannel.map((row) => (
                  <tr key={String(row._id)}>
                    <td className="px-4 py-3 font-mono text-xs">{channelName.get(String(row._id)) ?? String(row._id).slice(0, 8)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted">{row.calls.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{money(row.revenueMicros)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted">{money(row.costMicros)}</td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${profitClass(row.profitMicros)}`}>{money(row.profitMicros)}</td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${profitClass(row.profitMicros)}`}>{pct(row.profitMicros, row.revenueMicros)}</td>
                  </tr>
                ))}
                {byChannel.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center font-mono text-xs text-muted">
                      该时间段内暂无计费调用
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RelayShell>
  );
}
