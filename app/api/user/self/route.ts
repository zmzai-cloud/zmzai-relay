import { type NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";

import { resolveApiKey } from "@/providers/auth/apikey";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel, BalanceLedgerModel } from "@/providers/database/mongodb/models/balance";

export const dynamic = "force-dynamic";

/** New API compatible balance units: 500,000 quota units = 1 USD. */
const NEW_API_UNITS_PER_MICRO_DOLLAR = 0.5;

function unauthorized() {
  return NextResponse.json({ success: false, message: "需要有效的 API Token" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return unauthorized();

  const key = await resolveApiKey(authorization.slice(7).trim());
  if (!key) return unauthorized();

  await connectMongo();
  const [account, charged] = await Promise.all([
    BalanceAccountModel.findOne({ userId: key.userId }).lean(),
    BalanceLedgerModel.aggregate([
      { $match: { userId: accountUserId(key.userId), kind: "usage_charge" } },
      { $group: { _id: null, amountMicros: { $sum: { $abs: "$amountMicros" } } } },
    ]),
  ]);
  const availableMicros = account ? Math.max(0, account.balanceMicros - account.reservedMicros) : 0;
  const usedMicros = charged[0]?.amountMicros ?? 0;
  return NextResponse.json({
    success: true,
    data: {
      quota: Math.round(availableMicros * NEW_API_UNITS_PER_MICRO_DOLLAR),
      used_quota: Math.round(usedMicros * NEW_API_UNITS_PER_MICRO_DOLLAR),
      group: account ? "zmzai.cloud" : "待分配额度",
      currency: "USD",
      is_valid: true,
    },
  });
}

function accountUserId(value: string) {
  return new Types.ObjectId(value);
}
