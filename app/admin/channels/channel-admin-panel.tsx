"use client";

import { useState } from "react";
import { Badge, Button, Input } from "@zmzai/theme";
import { cnyMicrosLabel, cnyYuanToMicros, microsToCnyYuan } from "@/providers/billing/currency";
import { OFFICIAL_PRICES } from "@/providers/catalog/official-prices";

interface ModelMapping { public: string; upstream: string; }
interface ModelCostEntry { inputCostPer1kTokensMicros: number; outputCostPer1kTokensMicros: number; cacheReadCostPer1kTokensMicros?: number; cacheWriteCostPer1kTokensMicros?: number; }
interface Channel {
  _id: string; name: string; baseUrl: string; protocol: string; models: ModelMapping[]; priority: number;
  inputCostPer1kTokensMicros: number | null; outputCostPer1kTokensMicros: number | null;
  cacheReadCostPer1kTokensMicros: number | null; cacheWriteCostPer1kTokensMicros: number | null;
  modelCosts: Record<string, ModelCostEntry>;
  costMultiplier: number;
  executeMultiplier: number;
  consecutiveFailures: number;
  cooldownUntil: string | null;
  enabled: boolean; timeoutMs: number;
}
interface ChannelForm {
  name: string; baseUrl: string; apiKey: string; modelsText: string; priority: number; inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number; modelCostsText: string; costMultiplier: number; executeMultiplier: number; timeoutMs: number; enabled: boolean; costsPending: boolean;
}
interface ChannelTestResult {
  ok: boolean;
  models: { ok: boolean; status: number; latencyMs: number; error?: string } | null;
  completion: { ok: boolean; status: number; latencyMs: number; model: string; error?: string } | null;
}

const defaultMappings = "deepseek-v4-flash=deepseek-v4-flash, deepseek-v4-pro=deepseek-v4-pro";
const emptyForm = (): ChannelForm => ({ name: "", baseUrl: "", apiKey: "", modelsText: defaultMappings, priority: 10, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, modelCostsText: "", costMultiplier: 1, executeMultiplier: 1, timeoutMs: 60000, enabled: true, costsPending: true });
const modelCostsText = (modelCosts: Record<string, ModelCostEntry>) => Object.entries(modelCosts ?? {}).map(([modelName, entry]) => `${modelName}=${microsToCnyYuan(entry.inputCostPer1kTokensMicros)}/${microsToCnyYuan(entry.outputCostPer1kTokensMicros)}`).join(", ");
const formForChannel = (channel: Channel): ChannelForm => ({ name: channel.name, baseUrl: channel.baseUrl, apiKey: "", modelsText: channel.models.map((mapping) => `${mapping.public}=${mapping.upstream}`).join(", "), priority: channel.priority, inputCost: channel.inputCostPer1kTokensMicros === null ? 0 : microsToCnyYuan(channel.inputCostPer1kTokensMicros), outputCost: channel.outputCostPer1kTokensMicros === null ? 0 : microsToCnyYuan(channel.outputCostPer1kTokensMicros), cacheReadCost: channel.cacheReadCostPer1kTokensMicros === null ? 0 : microsToCnyYuan(channel.cacheReadCostPer1kTokensMicros), cacheWriteCost: channel.cacheWriteCostPer1kTokensMicros === null ? 0 : microsToCnyYuan(channel.cacheWriteCostPer1kTokensMicros), modelCostsText: modelCostsText(channel.modelCosts), costMultiplier: channel.costMultiplier ?? 1, executeMultiplier: channel.executeMultiplier ?? 1, timeoutMs: channel.timeoutMs, enabled: channel.enabled, costsPending: channel.inputCostPer1kTokensMicros === null });

/** 解析「模型=输入/输出」文本（元/1k）；格式不合法的条目直接丢弃，保存前由服务端 zod 兜底。 */
function parseModelCosts(text: string): Record<string, ModelCostEntry> {
  const result: Record<string, ModelCostEntry> = {};
  for (const entry of text.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)) {
    const [modelName, costs] = entry.split("=").map((item) => item.trim());
    const [input, output] = (costs ?? "").split("/").map((item) => Number(item.trim()));
    if (!modelName || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;
    result[modelName] = { inputCostPer1kTokensMicros: cnyYuanToMicros(input), outputCostPer1kTokensMicros: cnyYuanToMicros(output) };
  }
  return result;
}

function toPayload(form: ChannelForm, requireKey: boolean) {
  const models = form.modelsText.split(",").map((item) => item.trim()).filter(Boolean).map((pair) => {
    const [publicModel, upstream] = pair.split("=").map((item) => item.trim());
    return { public: publicModel, upstream: upstream || publicModel };
  });
  return {
    name: form.name, baseUrl: form.baseUrl, ...(requireKey ? { apiKey: form.apiKey } : { apiKey: form.apiKey.trim() }), models,
    priority: form.priority, inputCostPer1kTokensMicros: form.costsPending ? null : cnyYuanToMicros(form.inputCost),
    outputCostPer1kTokensMicros: form.costsPending ? null : cnyYuanToMicros(form.outputCost),
    cacheReadCostPer1kTokensMicros: form.costsPending ? null : cnyYuanToMicros(form.cacheReadCost),
    cacheWriteCostPer1kTokensMicros: form.costsPending ? null : cnyYuanToMicros(form.cacheWriteCost),
    modelCosts: parseModelCosts(form.modelCostsText),
    costMultiplier: form.costMultiplier,
    executeMultiplier: form.executeMultiplier,
    enabled: form.enabled, timeoutMs: form.timeoutMs,
  };
}

/** 双段探测结果文案：以真实推理（completion）结果为准，/models 只作连通性诊断。 */
function formatTestResult(json: ChannelTestResult): string {
  const completion = json.completion;
  if (completion?.ok) return `推理连通 (${completion.latencyMs}ms · ${completion.model})`;
  if (completion) return `推理失败：${completion.status || completion.error || "未知"}（models ${json.models?.status ?? "?"}）`;
  if (json.models?.ok) return `已连通 (${json.models.latencyMs}ms，无模型映射)`;
  return `连接失败：${json.models?.status || json.models?.error || "未知"}`;
}

export function ChannelAdminPanel({ initialChannels }: { initialChannels: Channel[] }) {
  const [channels, setChannels] = useState(initialChannels);
  const [form, setForm] = useState<ChannelForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editing = channels.find((channel) => channel._id === editingId) ?? null;

  function beginEdit(channel: Channel) { setEditingId(channel._id); setForm(formForChannel(channel)); setError(null); setNotice(null); }
  function cancelEdit() { setEditingId(null); setForm(emptyForm()); setError(null); setNotice(null); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    const requireKey = !editingId;
    if (requireKey && !form.apiKey.trim()) { setBusy(false); setError("请填写上游 Key"); return; }
    const response = await fetch(editingId ? `/api/admin/channels/${editingId}` : "/api/admin/channels", {
      method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(form, requireKey)),
    });
    const json = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(json.error ?? "保存失败"); return; }
    setChannels((previous) => (editingId ? previous.map((channel) => channel._id === editingId ? json.channel : channel) : [...previous, json.channel]).sort((a, b) => a.priority - b.priority));
    cancelEdit();
  }
  async function testChannel(id: string) {
    setTestResult((previous) => ({ ...previous, [id]: "测试中..." }));
    const response = await fetch(`/api/admin/channels/${id}/test`, { method: "POST" });
    const json = await response.json().catch(() => ({})) as ChannelTestResult;
    setTestResult((previous) => ({ ...previous, [id]: formatTestResult(json) }));
  }
  const update = <K extends keyof ChannelForm>(key: K, value: ChannelForm[K]) => setForm((previous) => ({ ...previous, [key]: value }));

  /** 按「官方价 × 成本倍率」生成模型级成本覆盖（元/1k）；不在官方价目表中的模型跳过。 */
  function applyCostMultiplier() {
    const models = form.modelsText.split(",").map((item) => item.trim()).filter(Boolean).map((pair) => (pair.split("=")[0] ?? "").trim());
    const skipped: string[] = [];
    const parts: string[] = [];
    for (const model of models) {
      const official = OFFICIAL_PRICES[model];
      if (!official) { skipped.push(model); continue; }
      const input = official.inputCnyPer1M * form.costMultiplier / 1000; // 元/1M → 元/1k
      const output = official.outputCnyPer1M * form.costMultiplier / 1000;
      parts.push(`${model}=${input.toFixed(4)}/${output.toFixed(4)}`);
    }
    if (!parts.length) { setError("模型映射中没有命中官方价目表的模型，请手动填写成本"); setNotice(null); return; }
    update("modelCostsText", parts.join(", "));
    setError(null);
    setNotice(skipped.length ? `已填充 ${parts.length} 个模型；未命中官方价目表已跳过：${skipped.join(", ")}` : `已按官方价 × ${form.costMultiplier} 生成成本覆盖（${parts.length} 个模型）`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* 渠道表 6 列，侧栏布局下左列放不下 44rem——上下结构全宽展示，避免横向滚动条 */}
        {channels.length ? (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
                  <th className="px-4 py-2.5 font-normal">渠道</th>
                  <th className="px-4 py-2.5 font-normal">优先级</th>
                  <th className="px-4 py-2.5 font-normal">模型</th>
                  <th className="px-4 py-2.5 font-normal">成本 / 1k</th>
                  <th className="px-4 py-2.5 font-normal">执行倍率</th>
                  <th className="px-4 py-2.5 font-normal">状态</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {channels.map((channel) => (
                  <tr key={channel._id} className="align-top transition-colors hover:bg-surface">
                    <td className="px-4 py-3">
                      <p className="font-medium">{channel.name}</p>
                      <p className="break-all font-mono text-xs text-muted">{channel.baseUrl}</p>
                      {testResult[channel._id] ? <p className="mt-1 font-mono text-xs text-accent">{testResult[channel._id]}</p> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">P{channel.priority}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{channel.models.map((mapping) => (mapping.public === mapping.upstream ? mapping.public : `${mapping.public}→${mapping.upstream}`)).join(" · ")}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {channel.inputCostPer1kTokensMicros === null
                        ? (Object.keys(channel.modelCosts ?? {}).length > 0 ? "模型级覆盖" : "待配置")
                        : `${cnyMicrosLabel(channel.inputCostPer1kTokensMicros, 4)} / ${cnyMicrosLabel(channel.outputCostPer1kTokensMicros ?? 0, 4)}`}
                      {Object.keys(channel.modelCosts ?? {}).length > 0 ? <span className="block">覆盖 {Object.keys(channel.modelCosts).length} 个模型</span> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">×{channel.executeMultiplier ?? 1}</td>
                    <td className="px-4 py-3">
                      <Badge variant={channel.enabled ? "success" : "outline"} size="sm">{channel.enabled ? "启用" : "停用"}</Badge>
                      {(() => {
                        const cooling = channel.cooldownUntil ? new Date(channel.cooldownUntil).getTime() > Date.now() : false;
                        if (cooling) return <span className="mt-1 block"><Badge variant="warning" size="sm">冷却中至 {new Date(channel.cooldownUntil as string).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</Badge></span>;
                        if ((channel.consecutiveFailures ?? 0) > 0) return <span className="mt-1 block"><Badge variant="warning" size="sm">连续失败 {channel.consecutiveFailures}</Badge></span>;
                        return null;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button type="button" variant="ghost" size="sm" onClick={() => beginEdit(channel)}>编辑</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => testChannel(channel._id)}>测试</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-line px-4 py-6 text-sm text-muted">还没有渠道，先在下方添加第一个上游。</p>
        )}
      </div>

      <div className="max-w-2xl rounded-lg border border-line bg-bg p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{editing ? `编辑 ${editing.name}` : "添加渠道"}</h2>
          {editing ? <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>取消</Button> : null}
        </div>
        <form onSubmit={save} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">名称</span><Input required value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">Base URL</span><Input required type="url" value={form.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} className="font-mono text-xs" placeholder="https://api.example.com/v1" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">上游 Key{editing ? "（留空则保持不变）" : ""}</span><Input required={!editing} value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} placeholder={editing ? "不回显；仅填写时替换" : "sk-..."} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">模型映射（对外名=上游名，逗号分隔）</span><Input required value={form.modelsText} onChange={(event) => update("modelsText", event.target.value)} className="font-mono text-xs" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">优先级（小=先试）</span><Input type="number" min="0" value={form.priority} onChange={(event) => update("priority", Number(event.target.value))} /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">超时（毫秒）</span><Input type="number" min="1000" max="300000" value={form.timeoutMs} onChange={(event) => update("timeoutMs", Number(event.target.value))} /></label>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} /> 启用</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.costsPending} onChange={(event) => update("costsPending", event.target.checked)} /> 成本待配置</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">输入成本（元/1k）</span><Input disabled={form.costsPending} type="number" min="0" step="0.0001" value={form.inputCost} onChange={(event) => update("inputCost", Number(event.target.value))} className="disabled:opacity-50" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">输出成本（元/1k）</span><Input disabled={form.costsPending} type="number" min="0" step="0.0001" value={form.outputCost} onChange={(event) => update("outputCost", Number(event.target.value))} className="disabled:opacity-50" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">缓存读成本（元/1k）</span><Input disabled={form.costsPending} type="number" min="0" step="0.0001" value={form.cacheReadCost} onChange={(event) => update("cacheReadCost", Number(event.target.value))} className="disabled:opacity-50" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">缓存写成本（元/1k）</span><Input disabled={form.costsPending} type="number" min="0" step="0.0001" value={form.cacheWriteCost} onChange={(event) => update("cacheWriteCost", Number(event.target.value))} className="disabled:opacity-50" /></label>
          </div>
          <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">模型级成本覆盖（模型=输入/输出 元/1k，逗号分隔；同渠道内模型单价不同时填，优先于渠道级）</span><Input value={form.modelCostsText} onChange={(event) => update("modelCostsText", event.target.value)} className="font-mono text-xs" placeholder="deepseek-v4-flash=0.1/0.2, deepseek-v4-pro=0.3/0.6" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">成本倍率（官方价 × 倍率 = 成本，仅用于自动填充）</span><Input type="number" min="0.01" step="0.01" value={form.costMultiplier} onChange={(event) => update("costMultiplier", Number(event.target.value))} className="font-mono text-xs" placeholder="例如 0.21（官方 2 折）" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs text-muted">执行倍率（对用户收费 = 标准价 × 倍率）</span><Input type="number" min="0.01" step="0.01" value={form.executeMultiplier} onChange={(event) => update("executeMultiplier", Number(event.target.value))} className="font-mono text-xs" placeholder="例如 0.6（标准价 6 折卖）" /></label>
            <Button type="button" variant="secondary" onClick={applyCostMultiplier} className="self-end">按倍率填充成本</Button>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {notice ? <p className="text-sm text-accent">{notice}</p> : null}
          <Button disabled={busy} className="self-start">{busy ? "保存中..." : editing ? "保存修改" : "添加渠道"}</Button>
        </form>
      </div>
    </div>
  );
}
