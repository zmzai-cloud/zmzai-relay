"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, Button } from "@zmzai/theme";
import { cnyFenLabel, cnyMicrosLabel } from "@/providers/billing/currency";
import type { WalletProduct } from "@/providers/billing/wallet-products";

type Order = {
  _id: string;
  orderNo: string;
  productName: string;
  creditMicros: number;
  paymentAmountFen: number;
  status: string;
  claimKey: string | null;
  expiresAt: string;
  createdAt: string;
  reviewNote: string | null;
};

const remainingMs = (order: Order) => new Date(order.expiresAt).getTime() - Date.now();

const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const statusView = (order: Order): { label: string; variant: "success" | "warning" | "danger" | "outline" } => {
  if (order.status === "completed") return { label: "已到账", variant: "success" };
  if (order.status === "rejected") return { label: "已驳回", variant: "danger" };
  if (order.status === "pending") return remainingMs(order) > 0 ? { label: "待管理员核对", variant: "warning" } : { label: "已过期", variant: "outline" };
  if (order.status === "expired") return { label: "已过期", variant: "outline" };
  if (order.status === "submitted") return { label: "待管理员核对", variant: "warning" };
  return { label: order.status, variant: "outline" };
};

/**
 * 充值申请面板（申请码流程，无线上支付露出）：
 * 选额度包 → 生成 5 分钟申请码 → 用户把码发给管理员 → 管理员在后台凭码确认收款后自动到账。
 */
export function BillingPanel({ products }: { products: WalletProduct[] }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 每秒重渲染以驱动申请码倒计时
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const loadOrders = useCallback(async () => {
    const res = await fetch("/api/me/orders");
    if (res.ok) {
      const json = await res.json();
      setOrders(Array.isArray(json.orders) ? json.orders : []);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  async function apply(productId: string) {
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await fetch("/api/me/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "申请失败，请稍后再试");
      return;
    }
    setActive(json.order);
    void loadOrders();
  }

  function copyCode(code: string) {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
  }

  const activeRemaining = active && active.status === "pending" ? remainingMs(active) : 0;

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-lg font-semibold">额度包</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {products.map((product) => (
            <div key={product.id} className="flex flex-col rounded-xl border border-line bg-bg p-5 transition-all duration-200 hover:border-line-strong hover:shadow-md">
              <p className="font-medium text-ink">{product.name}</p>
              <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
                <div>
                  <p className="text-xs text-muted">到账额度</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-ink">{cnyMicrosLabel(product.creditMicros, 2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">支付</p>
                  <p className="mt-1 font-mono text-lg font-medium text-ink-2">{cnyFenLabel(product.paymentAmountFen)}</p>
                </div>
              </div>
              <Button type="button" size="sm" className="mt-4" disabled={busy} onClick={() => apply(product.id)}>
                申请充值
              </Button>
            </div>
          ))}
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      {active ? (
        <section className="rounded-xl border border-line bg-bg p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">你的申请码</h2>
            {active.status === "pending" ? (
              <Badge variant={activeRemaining > 0 ? "warning" : "outline"} size="sm">
                {activeRemaining > 0 ? `有效期剩余 ${formatRemaining(activeRemaining)}` : "已过期，请重新申请"}
              </Badge>
            ) : null}
          </div>
          {active.status === "pending" && activeRemaining > 0 ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <span className="font-mono text-3xl font-semibold tracking-widest text-accent-readable">{active.claimKey}</span>
                <Button type="button" size="sm" variant="secondary" onClick={() => copyCode(active.claimKey ?? "")}>
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
              <p className="mt-4 text-sm leading-6 text-ink-2">
                请在有效期内将申请码发送给管理员，并说明本次充值的额度包（{active.productName} · {cnyFenLabel(active.paymentAmountFen)}）。管理员确认收款后，{cnyMicrosLabel(active.creditMicros, 2)} 额度会自动到账。
              </p>
            </>
          ) : active.status === "pending" ? (
            <p className="mt-4 text-sm text-muted">申请码已过期。过期申请不会扣费，重新选择额度包申请即可。</p>
          ) : (
            <p className="mt-4 text-sm text-muted">
              该申请状态为「{statusView(active).label}」。
            </p>
          )}
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">我的充值申请</h2>
        {orders.length === 0 ? (
          <p className="mt-4 rounded-lg border border-line px-4 py-6 text-sm text-muted">暂无申请记录。</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-bg">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
                  <th className="px-4 py-2.5 font-normal">额度包</th>
                  <th className="px-4 py-2.5 font-normal">申请码</th>
                  <th className="px-4 py-2.5 text-right font-normal">金额</th>
                  <th className="px-4 py-2.5 text-right font-normal">申请时间</th>
                  <th className="px-4 py-2.5 text-right font-normal">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((order) => {
                  const view = statusView(order);
                  return (
                    <tr key={order._id} className="transition-colors hover:bg-surface">
                      <td className="px-4 py-3">{order.productName}</td>
                      <td className="px-4 py-3">
                        {order.claimKey ? <span className="font-mono text-xs">{order.claimKey}</span> : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{cnyFenLabel(order.paymentAmountFen)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted">{new Date(order.createdAt).toLocaleString("zh-CN")}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant={view.variant} size="sm">{view.label}</Badge>
                        {order.status === "rejected" && order.reviewNote ? <span className="mt-1 block text-xs text-muted">{order.reviewNote}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
