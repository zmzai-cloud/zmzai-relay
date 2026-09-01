"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Card, Input } from "@zmzai/theme";
import { cnyMicrosLabel, cnyYuanToMicros, microsToCnyYuan } from "@/providers/billing/currency";
import { UserPicker, type UserPickerHandle, type WalletTarget } from "@/components/user-picker";

const QUICK_AMOUNTS = [20, 100, 500];

/**
 * 额度管理面板 —— 管理员自助划拨/补充额度。
 * 「划拨」从操作者自己的资金池扣减并计入目标账户（双向账本）；
 * 「直接授信」只给目标加款、不动资金池（补自己的额度走这条）。
 */
export function WalletPanel({ poolBalanceMicros, poolReservedMicros, me }: {
  poolBalanceMicros: number;
  poolReservedMicros: number;
  me: { id: string; name: string; email: string };
}) {
  const [pool, setPool] = useState({ balanceMicros: poolBalanceMicros, reservedMicros: poolReservedMicros });
  const [mode, setMode] = useState<"transfer" | "credit">("transfer");
  const [target, setTarget] = useState<WalletTarget | null>(null);
  const pickerRef = useRef<UserPickerHandle>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSelf = target?.id === me.id;
  const effectiveMode = isSelf ? "credit" : mode;
  const availableMicros = Math.max(0, pool.balanceMicros - pool.reservedMicros);

  const refreshPool = useCallback(async () => {
    const data = await fetch("/api/admin/wallet").then((res) => (res.ok ? res.json() : null)).catch(() => null);
    if (data && typeof data.balanceMicros === "number") {
      setPool({ balanceMicros: data.balanceMicros, reservedMicros: data.reservedMicros ?? 0 });
    }
  }, []);

  function pickSelf() {
    pickerRef.current?.fill({
      id: me.id,
      name: me.name,
      email: me.email,
      role: "admin",
      accounts: [],
      balanceMicros: pool.balanceMicros,
      availableMicros,
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!target) { setError("请先选择目标用户"); return; }
    const yuan = Number(amount);
    if (!Number.isFinite(yuan) || yuan <= 0) { setError("请输入大于 0 的金额"); return; }
    const amountMicros = cnyYuanToMicros(yuan);
    if (amountMicros <= 0) { setError("金额过小，请提高精度"); return; }
    if (effectiveMode === "transfer" && amountMicros > availableMicros) {
      setError(`资金池可用余额不足（当前 ${cnyMicrosLabel(availableMicros, 2)}）`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.id, amountMicros, mode: effectiveMode, reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error ?? "操作失败"); return; }
      setMessage(
        `${effectiveMode === "transfer" ? "已划拨" : "已授信"} ¥${yuan.toFixed(2)} → ${target.email}，` +
          `目标余额 ${cnyMicrosLabel(data.targetBalanceMicros ?? 0, 2)}`,
      );
      setAmount("");
      setReason("");
      if (effectiveMode === "transfer") setPool((prev) => ({ ...prev, balanceMicros: prev.balanceMicros - amountMicros }));
      await refreshPool();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <Card padding="lg" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">admin 资金池</p>
            <p className="mt-1 font-mono text-3xl text-ink">{cnyMicrosLabel(pool.balanceMicros, 2)}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={refreshPool}>刷新</Button>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">可划拨</dt>
            <dd className="font-mono">{cnyMicrosLabel(availableMicros, 2)}</dd>
          </div>
          <div>
            <dt className="text-muted">已预留</dt>
            <dd className="font-mono">{cnyMicrosLabel(pool.reservedMicros, 2)}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted">
          资金池就是你（{me.email}）的账户余额。划拨给别人从这里扣；补自己的额度用「直接授信」，不会二次扣减。
        </p>
        <div className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-muted">
          记账单位：1,000,000 micros = ¥8.00 — 输入 ¥500 即 {cnyYuanToMicros(500).toLocaleString()} micros
        </div>
      </Card>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-5">
        <h2 className="text-lg font-semibold">额度操作</h2>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={effectiveMode === "transfer"}
              disabled={isSelf}
              onChange={() => setMode("transfer")}
            />
            划拨（从资金池扣）
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={effectiveMode === "credit"}
              onChange={() => setMode("credit")}
            />
            直接授信（不动资金池）
          </label>
        </div>
        {isSelf ? <p className="text-xs text-muted">目标是你自己，已自动切到「直接授信」。</p> : null}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <UserPicker ref={pickerRef} value={target} onChange={setTarget} className="flex-1" />
            <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={pickSelf}>
              补给我自己
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            type="number"
            min="0.01"
            step="0.01"
            required
            placeholder="金额（人民币元）"
          />
          <div className="flex gap-2">
            {QUICK_AMOUNTS.map((value) => (
              <Button key={value} type="button" variant="secondary" size="sm" onClick={() => setAmount(String(value))}>
                ¥{value}
              </Button>
            ))}
          </div>
          {amount && Number(amount) > 0 ? (
            <p className="font-mono text-xs text-muted">
              = {cnyYuanToMicros(Number(amount)).toLocaleString()} micros
              {effectiveMode === "transfer" ? ` · 划拨后资金池 ${cnyMicrosLabel(Math.max(0, availableMicros - cnyYuanToMicros(Number(amount))), 2)}` : null}
            </p>
          ) : null}
        </div>

        <Input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="操作原因（写入账本与审计日志）" />

        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {message ? <p className="font-mono text-sm text-accent">{message}</p> : null}
        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "处理中…" : effectiveMode === "transfer" ? "确认划拨" : "确认授信"}
        </Button>
      </form>
    </div>
  );
}

/** 面板内展示用：micros → 元（4 位小数），与 currency 口径一致。 */
export const formatYuan = (micros: number) => microsToCnyYuan(micros).toFixed(4);
