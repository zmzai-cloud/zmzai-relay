import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import mongoose from "mongoose";
import { UserModel } from "@zmzai/db";
import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { AdminAuditModel } from "@/providers/database/mongodb/models/admin-audit";
import { BalanceAccountModel, BalanceLedgerModel } from "@/providers/database/mongodb/models/balance";

/**
 * 额度操作（管理员自助）：
 *  - transfer：从操作者（admin 资金池）划拨给目标用户，源账户记 transfer_out、目标记 transfer_in，双向账本
 *  - credit  ：直接授信给目标用户（等价于 /api/admin/balances 的加款），不扣减资金池
 * 金额单位 micros（1,000,000 micros = ¥8.00），正数加款、负数扣款。
 */
const schema = z.object({
  userId: z.string().min(1, "请选择目标用户"),
  amountMicros: z.coerce.number().int().refine((value) => value !== 0, "金额不能为 0"),
  mode: z.enum(["transfer", "credit"]),
  reason: z.string().min(1, "请填写操作原因").max(500),
});

function fail(code: string, status: number, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** 事务内取（或建）余额账户。 */
async function ensureAccount(userId: string, session: mongoose.ClientSession) {
  return BalanceAccountModel.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, balanceMicros: 0, reservedMicros: 0 } },
    { upsert: true, new: true, session },
  );
}

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return error instanceof AdminRequiredError
      ? fail("ADMIN_REQUIRED", 403, "需要管理员权限")
      : fail("UNAUTHENTICATED", 401, "登录状态无效");
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_BODY", 400, parsed.error.issues[0]?.message ?? "请求格式不正确");
  const input = parsed.data;

  await connectMongo();
  const target = await UserModel.findById(input.userId).select("name email").lean();
  if (!target) return fail("USER_NOT_FOUND", 404, "目标用户不存在");
  if (String(target._id) === admin.id && input.mode === "transfer") {
    return fail("INVALID_TARGET", 400, "不能划拨给自己，请用「直接授信」补充自己的额度");
  }

  const session = await mongoose.startSession();
  const result: { sourceAfter?: number; targetAfter: number } = { targetAfter: 0 };
  try {
    await session.withTransaction(async () => {
      const targetAccount = await ensureAccount(String(target._id), session);
      const targetBefore = targetAccount.balanceMicros;
      const targetAfterBalance = targetBefore + input.amountMicros;
      if (targetAfterBalance < targetAccount.reservedMicros) {
        throw new Error("目标账户余额不能低于已预留金额");
      }

      let sourceBefore: number | null = null;
      let sourceAfterBalance: number | null = null;

      if (input.mode === "transfer") {
        const sourceAccount = await ensureAccount(admin.id, session);
        sourceBefore = sourceAccount.balanceMicros;
        const availableMicros = sourceBefore - sourceAccount.reservedMicros;
        if (input.amountMicros > availableMicros) {
          throw new Error(`资金池可用余额不足（可用 ¥${((availableMicros * 8) / 1_000_000).toFixed(2)}）`);
        }
        sourceAfterBalance = sourceBefore - input.amountMicros;
        sourceAccount.balanceMicros = sourceAfterBalance;
        await sourceAccount.save({ session });
        result.sourceAfter = sourceAfterBalance;
        await BalanceLedgerModel.create(
          [{
            userId: admin.id,
            kind: "transfer_out",
            amountMicros: -input.amountMicros,
            balanceBeforeMicros: sourceBefore,
            balanceAfterMicros: sourceAfterBalance,
            usageId: null,
            operatorUserId: admin.id,
            note: `划拨给 ${target.email}｜${input.reason}`,
          }],
          { session },
        );
      }

      targetAccount.balanceMicros = targetAfterBalance;
      await targetAccount.save({ session });
      result.targetAfter = targetAfterBalance;

      await BalanceLedgerModel.create(
        [{
          userId: target._id,
          kind: input.mode === "transfer" ? "transfer_in" : (input.amountMicros > 0 ? "admin_credit" : "admin_debit"),
          amountMicros: input.amountMicros,
          balanceBeforeMicros: targetBefore,
          balanceAfterMicros: targetAfterBalance,
          usageId: null,
          operatorUserId: admin.id,
          note: input.mode === "transfer" ? `来自资金池划拨（操作者 ${admin.email}）｜${input.reason}` : input.reason,
        }],
        { session },
      );

      await AdminAuditModel.create(
        [{
          operatorUserId: admin.id,
          resourceType: input.mode === "transfer" ? "balance_transfer" : "balance",
          resourceId: String(target._id),
          before: { balanceMicros: targetBefore, ...(sourceBefore === null ? {} : { sourceBalanceMicros: sourceBefore }) },
          after: {
            balanceMicros: targetAfterBalance,
            amountMicros: input.amountMicros,
            ...(sourceAfterBalance === null ? {} : { sourceBalanceMicros: sourceAfterBalance }),
          },
          reason: `${input.mode === "transfer" ? "资金池划拨" : "直接授信"}｜${input.reason}`,
        }],
        { session },
      );
    });
  } catch (error) {
    return fail("TRANSFER_FAILED", 400, error instanceof Error ? error.message : "额度操作失败");
  } finally {
    await session.endSession();
  }

  return NextResponse.json({
    targetUserId: String(target._id),
    targetEmail: target.email,
    targetBalanceMicros: result.targetAfter,
    sourceBalanceMicros: result.sourceAfter,
  });
}
