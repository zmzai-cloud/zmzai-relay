import { redirect } from "next/navigation";
import { PageHeader } from "@zmzai/theme";

import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { UserModel } from "@zmzai/db";
import { WalletOrderModel } from "@/providers/database/mongodb/models/wallet-order";
import { OrderAdminPanel } from "./order-admin-panel";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/admin/orders")}`);
  if (user.role !== "admin") redirect("/dashboard");
  await connectMongo();
  const orders = await WalletOrderModel.find().sort({ createdAt: -1 }).limit(100).lean();
  const users = await UserModel.find({ _id: { $in: orders.map((order) => order.userId) } }).select("name email").lean();
  const userMap = new Map(users.map((item) => [String(item._id), { name: item.name, email: item.email }]));
  return (
    <RelayShell role="admin" userName={user.name}>
      <PageHeader
        icon="list"
        eyebrow="管理后台"
        title="充值订单"
        description="确认收款后，系统会把对应额度加入用户钱包，并写入充值流水。"
      />
      <div className="mt-8"><OrderAdminPanel initialOrders={orders.map((order) => ({ ...order, _id: String(order._id), expiresAt: order.expiresAt.toISOString(), submittedAt: order.submittedAt?.toISOString() ?? null, user: userMap.get(String(order.userId)) ?? null }))} /></div>
    </RelayShell>
  );
}
