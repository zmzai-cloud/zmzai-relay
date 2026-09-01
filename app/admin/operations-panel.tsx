"use client";

import { useState } from "react";
import { Button, Input } from "@zmzai/theme";
import { cnyYuanToMicros } from "@/providers/billing/currency";
import { UserPicker, type WalletTarget } from "@/components/user-picker";

export function OperationsPanel() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<WalletTarget | null>(null);
  const [saving, setSaving] = useState(false);

  async function price(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/admin/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: form.get("model"),
        inputPricePer1kMicros: cnyYuanToMicros(Number(form.get("input")) / 1000),
        outputPricePer1kMicros: cnyYuanToMicros(Number(form.get("output")) / 1000),
        cacheReadPricePer1kMicros: cnyYuanToMicros((Number(form.get("cacheRead")) || 0) / 1000),
        cacheWritePricePer1kMicros: cnyYuanToMicros((Number(form.get("cacheWrite")) || 0) / 1000),
        maxInputTokens: Number(form.get("maxInput")),
        maxOutputTokens: Number(form.get("maxOutput")),
        featured: form.get("featured") === "on",
        featuredDescription: form.get("featuredDescription") || "",
        enabled: true,
        reason: form.get("reason"),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { setError(data?.error ?? "价目保存失败"); return; }
    setMessage("价目已保存");
    event.currentTarget.reset();
  }

  async function balance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!target) { setError("请先选择目标用户"); return; }
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    if (!Number.isFinite(amount) || amount === 0) { setError("请输入非零金额"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: target.id,
          amountMicros: cnyYuanToMicros(amount),
          reason: form.get("reason"),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error ?? "余额调整失败"); return; }
      setMessage(`已为 ${target.email} 调整 ¥${amount.toFixed(2)}（直接授信，不从资金池扣减）`);
      event.currentTarget.reset();
      setTarget(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <form onSubmit={price} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-5">
        <h2 className="text-lg font-semibold">公开价目</h2>
        <Input name="model" required className="font-mono text-sm" placeholder="模型名，例如 gpt-5.6-terra" />
        <div className="grid grid-cols-2 gap-3">
          <Input name="input" required type="number" min="0" step="0.0001" placeholder="输入价格（元/1M）" />
          <Input name="output" required type="number" min="0" step="0.0001" placeholder="输出价格（元/1M）" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input name="cacheRead" type="number" min="0" step="0.0001" placeholder="缓存读价格（元/1M）" />
          <Input name="cacheWrite" type="number" min="0" step="0.0001" placeholder="缓存写价格（元/1M）" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input name="maxInput" required type="number" min="1" defaultValue="16384" />
          <Input name="maxOutput" required type="number" min="1" defaultValue="4096" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="featured" /> 设为推荐模型
        </label>
        <Input name="featuredDescription" placeholder="推荐描述，例如：速度、质量和成本表现均衡的模型" />
        <Input name="reason" required placeholder="调价原因" />
        <Button className="self-start">保存价目</Button>
      </form>

      <form onSubmit={balance} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-5">
        <h2 className="text-lg font-semibold">余额调整</h2>
        <p className="text-xs text-muted">
          直接给用户加款/扣款，不动 admin 资金池。要从资金池划拨请用「额度管理」。
        </p>
        <UserPicker value={target} onChange={setTarget} />
        <Input name="amount" required type="number" step="0.01" placeholder="金额（人民币元；负数为扣款）" />
        <Input name="reason" required placeholder="调整原因" />
        <Button className="self-start" disabled={saving}>{saving ? "处理中…" : "调整余额"}</Button>
      </form>

      {error ? <p className="text-sm text-danger lg:col-span-2">{error}</p> : null}
      {message ? <p className="font-mono text-sm text-accent lg:col-span-2">{message}</p> : null}
    </div>
  );
}
