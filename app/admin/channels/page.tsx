import { redirect } from "next/navigation";

import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";

import { ChannelAdminPanel } from "./channel-admin-panel";

export const dynamic = "force-dynamic";

export const metadata = { title: "渠道与路由 · Relay admin" };

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";

export default async function AdminChannelsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin/channels")}`);
  }
  if (user.role !== "admin") {
    redirect("/dashboard");
  }

  await connectMongo();
  const channels = await ChannelModel.find().sort({ priority: 1 }).lean();
  const safe = channels.map((c) => ({
    _id: String(c._id),
    name: c.name,
    baseUrl: c.baseUrl,
    protocol: c.protocol,
    models: c.models,
    priority: c.priority,
    inputCostPer1kTokensMicros: c.inputCostPer1kTokensMicros,
    outputCostPer1kTokensMicros: c.outputCostPer1kTokensMicros,
    cacheReadCostPer1kTokensMicros: c.cacheReadCostPer1kTokensMicros,
    cacheWriteCostPer1kTokensMicros: c.cacheWriteCostPer1kTokensMicros,
    modelCosts: c.modelCosts ?? {},
    costMultiplier: c.costMultiplier ?? 1,
    executeMultiplier: c.executeMultiplier ?? 1,
    enabled: c.enabled,
    timeoutMs: c.timeoutMs,
  }));

  return (
    <RelayShell role="admin" userName={user.name}>
      <h1 className="text-2xl font-semibold tracking-tight">渠道与路由</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">Token 不绑定渠道；系统按模型映射、启用状态与优先级转发，失败时自动尝试下一个上游。</p>
      <div className="mt-8"><ChannelAdminPanel initialChannels={safe} /></div>
    </RelayShell>
  );
}
