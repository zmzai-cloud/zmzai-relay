import { NextResponse } from "next/server";

import { getCurrentUser } from "@/providers/auth/session";

export const dynamic = "force-dynamic";

/** 当前登录用户 profile（name/email，账户块展示用）。未登录 401。 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  return NextResponse.json({ id: user.id, name: user.name, email: user.email });
}
