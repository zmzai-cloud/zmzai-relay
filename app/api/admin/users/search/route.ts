import { type NextRequest, NextResponse } from "next/server";

import { AccountModel, UserModel } from "@zmzai/db";
import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel } from "@/providers/database/mongodb/models/balance";

export const dynamic = "force-dynamic";

/** 搜索结果附带的 OAuth 绑定摘要，便于确认「就是这个人」。 */
export interface UserSearchAccount {
  provider: string;
  username: string | null;
}

const MAX_RESULTS = 10;

/**
 * 管理员搜索用户，供「额度管理」/「运营调整」选择目标（避免手输 Mongo ID）。
 *
 * 三条匹配路径取并集：
 *  1. users.email / users.name —— 邮箱注册、或昵称与登录名一致的账号
 *  2. accounts.username       —— GitHub / Google 登录名（users 表无此字段，只查 users 会漏）
 *  3. accounts.email          —— OAuth 绑定时 provider 返回的邮箱快照
 *
 * 至少 2 个字符才查询，最多返回 10 条，附带余额与登录方式便于确认目标。
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
  const regex = { $regex: pattern, $options: "i" };

  // 路径 2/3 会命中「站内昵称与第三方登录名不同」的人，只查 users 会漏，所以两处并行再合并。
  const [userMatches, accountMatches] = await Promise.all([
    UserModel.find({ $or: [{ email: regex }, { name: regex }] })
      .select("name email role status")
      .sort({ createdAt: -1 })
      .limit(MAX_RESULTS)
      .lean(),
    AccountModel.find({ $or: [{ username: regex }, { email: regex }] })
      .select("userId provider username email")
      .limit(MAX_RESULTS * 2)
      .lean(),
  ]);

  const byId = new Map(userMatches.map((user) => [String(user._id), user]));
  const missingIds = [...new Set(accountMatches.map((account) => String(account.userId)))].filter(
    (id) => !byId.has(id),
  );
  if (missingIds.length > 0) {
    const extra = await UserModel.find({ _id: { $in: missingIds } }).select("name email role status").lean();
    extra.forEach((user) => byId.set(String(user._id), user));
  }

  const users = [...byId.values()].slice(0, MAX_RESULTS);
  const userIds = users.map((user) => user._id);

  const [oauthAccounts, balanceAccounts] = await Promise.all([
    AccountModel.find({ userId: { $in: userIds } }).select("userId provider username").lean(),
    BalanceAccountModel.find({ userId: { $in: userIds } }).select("userId balanceMicros reservedMicros").lean(),
  ]);

  const oauthByUser = new Map<string, UserSearchAccount[]>();
  oauthAccounts.forEach((account) => {
    const key = String(account.userId);
    const list = oauthByUser.get(key) ?? [];
    list.push({ provider: account.provider, username: account.username ?? null });
    oauthByUser.set(key, list);
  });
  const balanceByUser = new Map(balanceAccounts.map((account) => [String(account.userId), account]));

  return NextResponse.json({
    users: users.map((user) => {
      const account = balanceByUser.get(String(user._id));
      const balanceMicros = account?.balanceMicros ?? 0;
      return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        accounts: oauthByUser.get(String(user._id)) ?? [],
        balanceMicros,
        availableMicros: Math.max(0, balanceMicros - (account?.reservedMicros ?? 0)),
      };
    }),
  });
}
