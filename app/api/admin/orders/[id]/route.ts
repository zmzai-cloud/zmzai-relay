import { type NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";

import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { AdminAuditModel } from "@/providers/database/mongodb/models/admin-audit";
import { BalanceAccountModel, BalanceLedgerModel } from "@/providers/database/mongodb/models/balance";
import { PaymentReconciliationModel } from "@/providers/database/mongodb/models/payment-reconciliation";
import { WalletOrderModel } from "@/providers/database/mongodb/models/wallet-order";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  reviewNote: z.string().trim().max(500).optional().or(z.literal("")),
  paidAmountFen: z.coerce.number().int().min(1).optional(),
  payerIdentifier: z.string().trim().max(100).optional().or(z.literal("")),
  transactionNote: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin;
  try { admin = await requireAdmin(); } catch (error) { if (error instanceof AdminRequiredError) return NextResponse.json({ error: "需要管理员权限", code: "ADMIN_REQUIRED" }, { status: 403 }); throw error; }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "审核参数不正确", code: "INVALID_BODY" }, { status: 400 });
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return NextResponse.json({ error: "订单不存在", code: "NOT_FOUND" }, { status: 404 });
  await connectMongo();
  const session = await mongoose.startSession();
  let result: Record<string, unknown> = {};
  try {
    await session.withTransaction(async () => {
      const order = await WalletOrderModel.findById(id).session(session);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      // 新流程用户只创建申请不提交凭证，pending 直接可审；submitted 保留旧流程兼容
      if (order.status !== "pending" && order.status !== "submitted") throw new Error("ORDER_NOT_SUBMITTED");
      const now = new Date();
      if (order.status === "pending" && order.expiresAt.getTime() <= now.getTime()) {
        order.status = "expired";
        await order.save({ session });
        throw new Error("ORDER_CLAIM_EXPIRED");
      }
      if (parsed.data.action === "reject") {
        order.status = "rejected";
        order.reviewedAt = now;
        order.reviewedBy = admin.id as never;
        order.reviewNote = parsed.data.reviewNote || "付款未核对通过";
        await order.save({ session });
        result = { status: order.status, orderNo: order.orderNo };
        return;
      }
      const paidAmountFen = parsed.data.paidAmountFen ?? order.paymentAmountFen;
      const account = await BalanceAccountModel.findOneAndUpdate(
        { userId: order.userId },
        { $setOnInsert: { userId: order.userId, balanceMicros: 0, reservedMicros: 0 } },
        { upsert: true, new: true, session },
      );
      if (!account) throw new Error("BALANCE_ACCOUNT_FAILED");
      const before = account.balanceMicros;
      account.balanceMicros += order.creditMicros;
      await account.save({ session });
      const ledger = await BalanceLedgerModel.create([{
        userId: order.userId,
        kind: "purchase_credit",
        amountMicros: order.creditMicros,
        balanceBeforeMicros: before,
        balanceAfterMicros: account.balanceMicros,
        usageId: null,
        operatorUserId: admin.id,
        note: `人工收款订单 ${order.orderNo}`,
      }], { session });
      await PaymentReconciliationModel.create([{
        orderId: order._id,
        orderNo: order.orderNo,
        userId: order.userId,
        paymentMethod: order.paymentMethod,
        paidAmountFen,
        paidAt: now,
        payerIdentifier: parsed.data.payerIdentifier || order.payerName || null,
        transactionNote: parsed.data.transactionNote || null,
        reviewerId: admin.id,
      }], { session });
      order.status = "completed";
      order.paidAt = now;
      order.completedAt = now;
      order.reviewedAt = now;
      order.reviewedBy = admin.id as never;
      order.reviewNote = parsed.data.reviewNote || null;
      order.fulfillmentId = String(ledger[0]._id);
      await order.save({ session });
      result = { status: order.status, orderNo: order.orderNo, balanceMicros: account.balanceMicros };
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ORDER_REVIEW_FAILED";
    const status = code === "ORDER_NOT_FOUND" ? 404 : code === "ORDER_NOT_SUBMITTED" ? 409 : code === "ORDER_CLAIM_EXPIRED" ? 409 : 400;
    return NextResponse.json({ error: code === "ORDER_NOT_FOUND" ? "订单不存在" : code === "ORDER_NOT_SUBMITTED" ? "订单已处理，不能重复审核" : code === "ORDER_CLAIM_EXPIRED" ? "申请码已过期，用户需重新申请" : "订单审核失败", code }, { status });
  } finally { await session.endSession(); }
  await AdminAuditModel.create({ operatorUserId: admin.id, resourceType: "wallet_order", resourceId: id, before: null, after: result, reason: parsed.data.reviewNote || `人工收款订单${parsed.data.action === "approve" ? "确认" : "驳回"}` });
  return NextResponse.json(result);
}
