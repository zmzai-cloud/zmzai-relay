import { NextResponse } from "next/server";

import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel } from "@/providers/database/mongodb/models/balance";

export const dynamic = "force-dynamic";

/** 管理后台「额度管理」页的资金池读数：管理员自身账户的余额与预留额（micros）。 */
export async function GET() {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return error instanceof AdminRequiredError
      ? NextResponse.json({ error: "需要管理员权限", code: "ADMIN_REQUIRED" }, { status: 403 })
      : NextResponse.json({ error: "登录状态无效", code: "UNAUTHENTICATED" }, { status: 401 });
  }

  await connectMongo();
  const account = await BalanceAccountModel.findOne({ userId: admin.id })
    .select("balanceMicros reservedMicros")
    .lean();

  return NextResponse.json({
    balanceMicros: account?.balanceMicros ?? 0,
    reservedMicros: account?.reservedMicros ?? 0,
  });
}
