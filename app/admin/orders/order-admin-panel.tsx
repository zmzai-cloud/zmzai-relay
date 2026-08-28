"use client";

import { useState } from "react";
import { Badge, Button } from "@zmzai/theme";
import { cnyFenLabel, cnyMicrosLabel } from "@/providers/billing/currency";

type Order = { _id: string; orderNo: string; productName: string; creditMicros: number; paymentAmountFen: number; paymentMethod: "wechat" | "alipay"; status: string; claimKey: string | null; expiresAt: string; payerName: string | null; screenshotUrl: string | null; paymentNote: string | null; submittedAt: string | null; user: { name: string; email: string } | null; reviewNote: string | null };
const cny = cnyFenLabel;
const statusVariant = (status: string): "success" | "warning" | "danger" | "outline" => {
  if (status === "completed" || status === "approved" || status === "paid") return "success";
  if (status === "submitted" || status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "outline";
};
const statusLabel = (status: string): string => {
  if (status === "completed" || status === "approved" || status === "paid") return "已确认收款";
  if (status === "submitted") return "待确认";
  if (status === "pending") return "申请中";
  if (status === "rejected") return "已驳回";
  if (status === "expired") return "已过期";
  return status;
};

const reviewable = (order: Order) => order.status === "pending" || order.status === "submitted";

export function OrderAdminPanel({ initialOrders }: { initialOrders: Order[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [filtered, setFiltered] = useState(false);
  async function review(order: Order, action: "approve" | "reject") {
    const reviewNote = window.prompt(action === "approve" ? "核对备注（可留空）" : "驳回原因（必填）", "");
    if (reviewNote === null || (action === "reject" && !reviewNote.trim())) return;
    setBusy(order._id); setMessage(null);
    const response = await fetch(`/api/admin/orders/${order._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reviewNote }) });
    const json = await response.json().catch(() => ({})); setBusy(null);
    if (!response.ok) { setMessage(json.error ?? "审核失败"); if (filtered) findByKey(); return; }
    setOrders((current) => current.map((item) => item._id === order._id ? { ...item, status: json.status, reviewNote } : item)); setMessage(`${order.orderNo} 已${action === "approve" ? "确认收款并开通" : "驳回"}`);
  }
  // 凭申请码查找：用户微信发来的码直接定位订单
  async function findByKey() {
    const key = lookup.trim();
    if (!key) return;
    setMessage(null);
    const response = await fetch(`/api/admin/orders?claimKey=${encodeURIComponent(key)}`);
    const json = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(json.error ?? "查找失败"); return; }
    setOrders(json.orders ?? []);
    setFiltered(true);
    setMessage((json.orders ?? []).length ? null : `没有找到申请码 ${key} 的申请`);
  }
  async function showAll() {
    const response = await fetch("/api/admin/orders");
    const json = await response.json().catch(() => ({}));
    if (response.ok) { setOrders(json.orders ?? []); setFiltered(false); setLookup(""); setMessage(null); }
  }
  return (
    <div>
      <p className="text-sm text-muted">用户申请后会收到一个 5 分钟有效的申请码并发给你；以微信/支付宝实际到账记录为准，确认后立即增加用户余额，且不能重复确认。</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={lookup}
          onChange={(event) => setLookup(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void findByKey(); }}
          placeholder="输入用户发来的申请码，如 R7K2M9QX"
          className="h-10 w-64 rounded-md border border-line bg-bg px-3 font-mono text-sm outline-none focus:border-accent"
        />
        <Button type="button" size="sm" onClick={() => void findByKey()} disabled={!lookup.trim()}>查找</Button>
        {filtered ? <Button type="button" size="sm" variant="secondary" onClick={() => void showAll()}>显示全部</Button> : null}
      </div>
      {orders.length === 0 ? (
        <p className="mt-6 rounded-lg border border-line px-4 py-6 text-sm text-muted">暂无充值订单。</p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-bg">
          {orders.map((order) => (
            <li key={order._id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-sm">{order.orderNo}</p>
                  <p className="mt-1 text-sm">{order.user?.name ?? "未知用户"} · {order.user?.email ?? ""}</p>
                </div>
                <Badge variant={statusVariant(order.status)} size="sm">{statusLabel(order.status)}</Badge>
              </div>
              <p className="mt-3 font-mono text-xs text-muted">
                申请码 {order.claimKey ?? "—"} · 收款 {cny(order.paymentAmountFen)} · 到账 {cnyMicrosLabel(order.creditMicros, 2)}{order.status === "pending" && order.expiresAt ? ` · 码有效期至 ${new Date(order.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted">付款人：{order.payerName || "未填写"}{order.paymentNote ? ` · ${order.paymentNote}` : ""}</p>
              {order.screenshotUrl ? <a href={order.screenshotUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-xs text-accent-readable underline">查看付款截图</a> : null}
              {reviewable(order) ? (
                <div className="mt-4 flex gap-3">
                  <Button type="button" disabled={busy === order._id} onClick={() => review(order, "approve")} className="disabled:opacity-50">确认收款并开通</Button>
                  <Button type="button" variant="danger" size="sm" disabled={busy === order._id} onClick={() => review(order, "reject")} className="disabled:opacity-50">驳回申请</Button>
                </div>
              ) : order.reviewNote ? (
                <p className="mt-3 text-xs text-muted">审核备注：{order.reviewNote}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {message ? <p className="mt-4 text-sm text-accent-readable">{message}</p> : null}
    </div>
  );
}
