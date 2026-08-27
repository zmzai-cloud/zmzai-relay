"use client";

import { useRef, useState } from "react";
import { Badge, Button, Input } from "@zmzai/theme";
import { cnyMicrosLabel, cnyYuanToMicros, microsToCnyYuan } from "@/providers/billing/currency";

const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** 官方价目表（2026-08 更新）。单位：元/1M tokens。
 *  GPT 系列官方为美元价，按 $1≈¥6.75 折算，note 标注官方美元价；
 *  DeepSeek 为高峰价（北京时间周一至周五 9-12/14-18 点），闲时减半；
 *  修改售价时建议先核对官方定价页。 */
interface OfficialPrice {
  inputCnyPer1M: number;
  outputCnyPer1M: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  note?: string;
}
const OFFICIAL_PRICES: Record<string, OfficialPrice> = {
  "gpt-5.6-sol": { inputCnyPer1M: 27, outputCnyPer1M: 135, maxInputTokens: 1_050_000, maxOutputTokens: 128_000, note: "$4/$20 促销至 11/21" },
  "gpt-5.6-terra": { inputCnyPer1M: 13.5, outputCnyPer1M: 81, maxInputTokens: 1_000_000, maxOutputTokens: 128_000, note: "$2/$12" },
  "gpt-5.6-luna": { inputCnyPer1M: 1.35, outputCnyPer1M: 8.1, maxInputTokens: 1_000_000, maxOutputTokens: 128_000, note: "$0.2/$1.2" },
  "deepseek-v4-flash": { inputCnyPer1M: 3, outputCnyPer1M: 9, maxInputTokens: 1_000_000, maxOutputTokens: 384_000, note: "高峰价" },
  "deepseek-v4-pro": { inputCnyPer1M: 9, outputCnyPer1M: 27, maxInputTokens: 1_000_000, maxOutputTokens: 384_000, note: "高峰价" },
  "mimo-v2.5": { inputCnyPer1M: 1, outputCnyPer1M: 2, maxInputTokens: 1_000_000, maxOutputTokens: 131_072 },
  "mimo-v2.5-pro": { inputCnyPer1M: 3, outputCnyPer1M: 6, maxInputTokens: 1_000_000, maxOutputTokens: 131_072 },
};

export interface ModelPriceRow {
  model: string;
  multiplier: number;
  inputPricePer1kMicros: number;
  outputPricePer1kMicros: number;
  cacheReadPricePer1kMicros: number;
  cacheWritePricePer1kMicros: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  allowedReasoningEfforts: string[];
  featured: boolean;
  featuredDescription: string;
  enabled: boolean;
}

export function ModelsPanel({ initialPrices }: { initialPrices: ModelPriceRow[] }) {
  const [prices, setPrices] = useState(initialPrices);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [official, setOfficial] = useState<OfficialPrice | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/prices").then((r) => r.json()).catch(() => null);
    if (res?.prices) setPrices(res.prices);
  }

  function fillForm(row: ModelPriceRow) {
    const form = formRef.current;
    if (!form) return;
    const setValue = (name: string, value: string | boolean) => {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement) {
        if (el.type === "checkbox") el.checked = Boolean(value);
        else el.value = String(value);
      }
    };
    setValue("model", row.model);
    setValue("multiplier", String(row.multiplier ?? 1));
    // 数据库存元/1k，表单按元/1M 录入/回填（×1000）
    setValue("input", (microsToCnyYuan(row.inputPricePer1kMicros) * 1000).toFixed(4));
    setValue("output", (microsToCnyYuan(row.outputPricePer1kMicros) * 1000).toFixed(4));
    setValue("cacheRead", (microsToCnyYuan(row.cacheReadPricePer1kMicros) * 1000).toFixed(4));
    setValue("cacheWrite", (microsToCnyYuan(row.cacheWritePricePer1kMicros) * 1000).toFixed(4));
    setValue("maxInput", String(row.maxInputTokens));
    setValue("maxOutput", String(row.maxOutputTokens));
    setValue("featured", row.featured);
    setValue("featuredDescription", row.featuredDescription);
    setValue("enabled", row.enabled);
    for (const effort of REASONING_EFFORTS) setValue(`effort-${effort}`, row.allowedReasoningEfforts.includes(effort));
  }

  function startEdit(row: ModelPriceRow) {
    setEditing(row.model);
    setMessage(null);
    setError(null);
    fillForm(row);
  }

  function startNew() {
    setEditing(null);
    setMessage(null);
    setError(null);
    setOfficial(null);
    const form = formRef.current;
    if (!form) return;
    form.reset();
    const model = form.elements.namedItem("model");
    if (model instanceof HTMLInputElement) model.readOnly = false;
  }

  /** 按「官方价 × 倍率」填充价格与 token 上限；未知官方价则提示手动填写。 */
  function applyMultiplier() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const model = String(data.get("model") || "").trim();
    const official = OFFICIAL_PRICES[model];
    if (!official) { setError("该模型不在官方价目表中，请手动填写价格"); setMessage(null); return; }
    const multiplier = Number(data.get("multiplier")) || 1;
    const setValue = (name: string, value: string) => {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement) el.value = value;
    };
    setValue("input", (official.inputCnyPer1M * multiplier).toFixed(4));
    setValue("output", (official.outputCnyPer1M * multiplier).toFixed(4));
    setValue("maxInput", String(official.maxInputTokens));
    setValue("maxOutput", String(official.maxOutputTokens));
    setError(null);
    setMessage(`已按官方价 × ${multiplier} 填充（输入 ¥${(official.inputCnyPer1M * multiplier).toFixed(4)}/1M · 输出 ¥${(official.outputCnyPer1M * multiplier).toFixed(4)}/1M）`);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      model: String(form.get("model") || "").trim(),
      multiplier: Number(form.get("multiplier")) || 1,
      // 表单按元/1M 录入，后端存元/1k（÷1000）
      inputPricePer1kMicros: cnyYuanToMicros(Number(form.get("input")) / 1000),
      outputPricePer1kMicros: cnyYuanToMicros(Number(form.get("output")) / 1000),
      cacheReadPricePer1kMicros: cnyYuanToMicros((Number(form.get("cacheRead")) || 0) / 1000),
      cacheWritePricePer1kMicros: cnyYuanToMicros((Number(form.get("cacheWrite")) || 0) / 1000),
      maxInputTokens: Number(form.get("maxInput")),
      maxOutputTokens: Number(form.get("maxOutput")),
      allowedReasoningEfforts: REASONING_EFFORTS.filter((effort) => form.get(`effort-${effort}`) === "on"),
      featured: form.get("featured") === "on",
      featuredDescription: String(form.get("featuredDescription") || ""),
      enabled: form.get("enabled") === "on",
      reason: String(form.get("reason") || ""),
    };
    if (!body.model) { setError("模型名不能为空"); setMessage(null); return; }
    if (!body.allowedReasoningEfforts.length) { setError("至少勾选一种推理强度"); setMessage(null); return; }
    const res = await fetch("/api/admin/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) { setError(data?.error ?? "保存失败"); setMessage(null); return; }
    setMessage(editing ? `「${body.model}」已更新` : `「${body.model}」已注册`);
    setError(null);
    setEditing(null);
    await refresh();
  }

  async function toggleEnabled(row: ModelPriceRow) {
    const res = await fetch("/api/admin/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      model: row.model,
      multiplier: row.multiplier ?? 1,
      inputPricePer1kMicros: row.inputPricePer1kMicros,
      outputPricePer1kMicros: row.outputPricePer1kMicros,
      cacheReadPricePer1kMicros: row.cacheReadPricePer1kMicros,
      cacheWritePricePer1kMicros: row.cacheWritePricePer1kMicros,
      maxInputTokens: row.maxInputTokens,
      maxOutputTokens: row.maxOutputTokens,
      allowedReasoningEfforts: row.allowedReasoningEfforts,
      featured: row.featured,
      featuredDescription: row.featuredDescription,
      enabled: !row.enabled,
      reason: `管理后台${row.enabled ? "停用" : "启用"}模型`,
    }) });
    if (!res.ok) { setError("操作失败"); setMessage(null); return; }
    await refresh();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{editing ? `编辑模型 · ${editing}` : "注册新模型"}</h2>
          {editing ? <button type="button" onClick={startNew} className="text-sm text-accent-readable underline underline-offset-4">取消编辑</button> : null}
        </div>
        <Input name="model" required readOnly={Boolean(editing)} className="font-mono text-sm" placeholder="模型名，例如 mimo-v2.5-pro" onInput={(e) => setOfficial(OFFICIAL_PRICES[(e.target as HTMLInputElement).value.trim()] ?? null)} />
        {official ? (
          <p className="font-mono text-xs text-muted">官方价：输入 ¥{official.inputCnyPer1M}/1M · 输出 ¥{official.outputCnyPer1M}/1M{official.note ? `（${official.note}）` : null}，上限 {official.maxInputTokens.toLocaleString()} 入 / {official.maxOutputTokens.toLocaleString()} 出</p>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <Input name="multiplier" required type="number" min="0.01" step="0.01" defaultValue="1" className="" placeholder="倍率（官方价 × 倍率 = 售价）" />
          <Button type="button" variant="secondary" onClick={applyMultiplier} className="shrink-0">按倍率填充</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input name="input" required type="number" min="0" step="0.0001" className="" placeholder="输入价格（元/1M）" />
          <Input name="output" required type="number" min="0" step="0.0001" className="" placeholder="输出价格（元/1M）" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input name="cacheRead" type="number" min="0" step="0.0001" className="" placeholder="缓存读价格（元/1M）" />
          <Input name="cacheWrite" type="number" min="0" step="0.0001" className="" placeholder="缓存写价格（元/1M）" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input name="maxInput" required type="number" min="1" defaultValue="16384" className="" />
          <Input name="maxOutput" required type="number" min="1" defaultValue="4096" className="" />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">推理强度</span>
          {REASONING_EFFORTS.map((effort) => (
            <label key={effort} className="flex items-center gap-1.5">
              <input type="checkbox" name={`effort-${effort}`} defaultChecked className="" />
              {effort}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="featured" className="" /> 设为推荐模型</label>
        <Input name="featuredDescription" className="" placeholder="推荐描述，例如：速度、质量和成本表现均衡的模型" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked className="" /> 开放调用</label>
        <Input name="reason" required className="" placeholder="操作原因（写入审计日志）" />
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {message ? <p className="font-mono text-sm text-accent-readable">{message}</p> : null}
        <Button className="self-start">保存模型</Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">模型</th>
              <th className="px-4 py-2.5 font-normal">状态</th>
              <th className="px-4 py-2.5 text-right font-normal">输入 / 1M</th>
              <th className="px-4 py-2.5 text-right font-normal">输出 / 1M</th>
              <th className="px-4 py-2.5 text-right font-normal">倍率</th>
              <th className="px-4 py-2.5 text-right font-normal">最大输出 tokens</th>
              <th className="px-4 py-2.5 font-normal">推理强度</th>
              <th className="px-4 py-2.5 font-normal">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {prices.map((row) => (
              <tr key={row.model}>
                <td className="px-4 py-3 font-mono text-xs">
                  {row.model}
                  {row.featured ? <span className="ml-2"><Badge variant="accent" size="sm">推荐</Badge></span> : null}
                </td>
                <td className="px-4 py-3"><Badge variant={row.enabled ? "success" : "outline"} size="sm">{row.enabled ? "已开放" : "已停用"}</Badge></td>
                <td className="px-4 py-3 text-right font-mono text-xs">{cnyMicrosLabel(row.inputPricePer1kMicros * 1000)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{cnyMicrosLabel(row.outputPricePer1kMicros * 1000)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-muted">×{row.multiplier ?? 1}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{row.maxOutputTokens.toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{row.allowedReasoningEfforts.join(" · ")}</td>
                <td className="px-4 py-3">
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => startEdit(row)} className="text-sm text-accent-readable underline underline-offset-4">编辑</button>
                    <button type="button" onClick={() => toggleEnabled(row)} className="text-sm text-muted underline underline-offset-4">{row.enabled ? "停用" : "启用"}</button>
                  </div>
                </td>
              </tr>
            ))}
            {prices.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">还没有注册任何模型，先在左侧表单添加一个。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
