import { redirect } from "next/navigation";
import { Badge, PageHeader } from "@zmzai/theme";
import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { ModelPriceModel } from "@/providers/database/mongodb/models/model-price";
import { cnyMicrosLabel } from "@/providers/billing/currency";
import { ModelsPanel } from "./models-panel";
import { ProbeButton } from "./probe-button";
import { OnboardingWizard } from "./onboarding-wizard";
import { ModelHealthModel } from "@/providers/database/mongodb/models/model-health";
import { ModelHealthStatus } from "./model-health-status";
import { ModelProbeModel } from "@/providers/database/mongodb/models/model-probe";
import { probeFingerprint } from "@/providers/catalog/model-probe";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
const money = (value: number) => cnyMicrosLabel(value * 1000); // 价目表按元/1M 展示
export const dynamic = "force-dynamic";
export default async function ModelsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin/models")}`);
  if (user.role !== "admin") redirect("/dashboard");
  await connectMongo();
  const [models, channels, probes, health] = await Promise.all([ModelPriceModel.find().sort({ model: 1 }).lean(), ChannelModel.find().select("+apiKey").sort({ priority: 1 }).lean(), ModelProbeModel.find().select("+fingerprint").lean(), ModelHealthModel.find().select("+fingerprint").lean()]);
  const healthMap = new Map(health.map(h => [`${h.channelId}:${h.publicModel}`,h]));
  const probeMap = new Map(probes.map(p => [`${p.channelId}:${p.publicModel}`,p]));
  const priceMap = new Map(models.map((m) => [m.model, m]));
  const rows = channels.flatMap((channel) =>
    channel.models
      .filter((mapping) => priceMap.has(mapping.public))
      .map((mapping) => ({ channel, mapping, model: priceMap.get(mapping.public)! })),
  );
  return (
    <RelayShell role="admin" userName={user.name}>
      <PageHeader
        icon="coins"
        eyebrow="管理后台"
        title="模型与价格"
        description="价格与推理强度在这里管理；上游映射在「渠道与路由」维护。"
      />

      <OnboardingWizard channels={channels.map(c => ({id:String(c._id),name:c.name,executeMultiplier:c.executeMultiplier??1}))} existingModels={models.map(m=>({model:m.model,inputPricePer1kMicros:m.inputPricePer1kMicros,outputPricePer1kMicros:m.outputPricePer1kMicros,cacheReadPricePer1kMicros:m.cacheReadPricePer1kMicros,cacheWritePricePer1kMicros:m.cacheWritePricePer1kMicros,maxInputTokens:m.maxInputTokens,maxOutputTokens:m.maxOutputTokens,allowedReasoningEfforts:m.allowedReasoningEfforts}))} />
      <h2 className="mt-8 text-lg font-semibold">渠道</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">渠道</th>
              <th className="px-4 py-2.5 font-normal">状态</th>
              <th className="px-4 py-2.5 font-normal">优先级</th>
              <th className="px-4 py-2.5 font-normal">成本</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {channels.map((channel) => {
              const costReady = channel.inputCostPer1kTokensMicros !== null && channel.outputCostPer1kTokensMicros !== null;
              return (
                <tr key={String(channel._id)}>
                  <td className="px-4 py-3 font-medium">{channel.name}</td>
                  <td className="px-4 py-3"><Badge variant={channel.enabled ? "success" : "outline"} size="sm">{channel.enabled ? "启用" : "停用"}</Badge></td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">P{channel.priority}</td>
                  <td className="px-4 py-3"><Badge variant={costReady ? "success" : "warning"} size="sm">{costReady ? "已配置" : "待配置"}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-lg font-semibold">模型管理</h2>
      <p className="mt-2 text-sm text-ink-2">注册新模型、调整价格与 max_tokens 上限、启停模型。新增后即可在「渠道与路由」中为其配置上游映射。</p>
      <div className="mt-3">
        <ModelsPanel initialPrices={models.map((m) => ({
          model: m.model,
          multiplier: m.multiplier ?? 1,
          inputPricePer1kMicros: m.inputPricePer1kMicros,
          outputPricePer1kMicros: m.outputPricePer1kMicros,
          cacheReadPricePer1kMicros: m.cacheReadPricePer1kMicros,
          cacheWritePricePer1kMicros: m.cacheWritePricePer1kMicros,
          maxInputTokens: m.maxInputTokens,
          maxOutputTokens: m.maxOutputTokens,
          allowedReasoningEfforts: m.allowedReasoningEfforts,
          featured: m.featured,
          featuredDescription: m.featuredDescription,
          enabled: m.enabled,
          publicVisible: m.publicVisible !== false,
        }))} />
      </div>

      <h2 className="mt-10 text-lg font-semibold">模型价目</h2>
      <p className="mt-2 text-sm text-muted">测试会向上游发送一次简短请求，可能产生少量费用。</p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">模型</th>
              <th className="px-4 py-2.5 font-normal">渠道</th>
              <th className="px-4 py-2.5 font-normal">状态</th>
              <th className="px-4 py-2.5 font-normal">路由状态</th>
              <th className="px-4 py-2.5 font-normal">手动测试</th>
              <th className="px-4 py-2.5 font-normal">推理强度</th>
              <th className="px-4 py-2.5 text-right font-normal">输入 / 1M</th>
              <th className="px-4 py-2.5 text-right font-normal">输出 / 1M</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ channel, mapping, model }) => (
              <tr key={`${channel.name}-${mapping.public}`}>
                <td className="px-4 py-3 font-mono text-xs">{mapping.public}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{channel.name}</td>
                <td className="px-4 py-3"><Badge variant={model.enabled ? "success" : "outline"} size="sm">{model.enabled ? "已开放" : "已停用"}</Badge></td>
                <td className="px-4 py-3">{(() => {const h=healthMap.get(`${channel._id}:${mapping.public}`);const fingerprint=probeFingerprint({baseUrl:channel.baseUrl,apiKey:channel.apiKey,publicModel:mapping.public,upstreamModel:mapping.upstream});return <ModelHealthStatus health={h?.fingerprint===fingerprint?h:null}/>})()}</td>
                <td className="px-4 py-3"><ProbeButton channelId={String(channel._id)} model={mapping.public} initial={(() => { const p = probeMap.get(`${channel._id}:${mapping.public}`); return p ? {ok:p.ok,category:p.category,testedAt:p.testedAt.toISOString(),stale:p.fingerprint !== probeFingerprint({baseUrl:channel.baseUrl,apiKey:channel.apiKey,publicModel:mapping.public,upstreamModel:mapping.upstream})} : null; })()} /></td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{model.allowedReasoningEfforts.join(" · ")}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{money(model.inputPricePer1kMicros)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{money(model.outputPricePer1kMicros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RelayShell>
  );
}
