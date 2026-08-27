import { NextResponse } from "next/server";

import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { BalanceAccountModel } from "@/providers/database/mongodb/models/balance";

export const dynamic = "force-dynamic";

/** 顶栏余额显示用：登录会话鉴权，返回可用余额（micros）。未登录返回 401，外壳静默隐藏。 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  await connectMongo();
  const account = await BalanceAccountModel.findOne({ userId: user.id })
    .select("balanceMicros reservedMicros")
    .lean();
  const availableMicros = account ? Math.max(0, account.balanceMicros - account.reservedMicros) : 0;
  return NextResponse.json({ availableMicros });
}
