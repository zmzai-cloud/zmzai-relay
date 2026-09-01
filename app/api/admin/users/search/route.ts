import { type NextRequest, NextResponse } from "next/server";

import { UserModel } from "@zmzai/db";
import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel } from "@/providers/database/mongodb/models/balance";

export const dynamic = "force-dynamic";

/**
 * 管理员按邮箱/姓名搜索用户，供「额度管理」选择划拨目标（避免手输 Mongo ID）。
 * 至少 2 个字符才查询，最多返回 10 条，附带余额便于确认目标账户。
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return error instanceof AdminRequiredError
      ? NextResponse.json({ error: "需要管理员权限", code: "ADMIN_REQUIRED" }, { status: 403 })
      : NextResponse.json({ error: "登录状态无效", code: "UNAUTHENTICATED" }, { status: 401 });
  }

  const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < 2) return NextResponse.json({ users: [] });

  await connectMongo();
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const users = await UserModel.find({
    $or: [{ email: { $regex: pattern, $options: "i" } }, { name: { $regex: pattern, $options: "i" } }],
  })
    .select("name email role status")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const accounts = await BalanceAccountModel.find({ userId: { $in: users.map((user) => user._id) } })
    .select("userId balanceMicros reservedMicros")
    .lean();
  const accountByUser = new Map(accounts.map((account) => [String(account.userId), account]));

  return NextResponse.json({
    users: users.map((user) => {
      const account = accountByUser.get(String(user._id));
      const balanceMicros = account?.balanceMicros ?? 0;
      return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        balanceMicros,
        availableMicros: Math.max(0, balanceMicros - (account?.reservedMicros ?? 0)),
      };
    }),
  });
}
