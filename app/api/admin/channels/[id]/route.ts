import { type NextRequest, NextResponse } from "next/server";

import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { channelConfigSchema, assertModelsRegistered } from "@/providers/channels/schema";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { validateUpstreamUrl } from "@/providers/network/safe-upstream-fetch";

function err(code: string, status: number, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminRequiredError) return err("ADMIN_REQUIRED", 403, "需要管理员权限");
    throw error;
  }

  const body = await req.json().catch(() => null);
  const parsed = channelConfigSchema.safeParse(body && typeof body === "object" ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "apiKey")) : body);
  if (!parsed.success) return err("INVALID_BODY", 400, "渠道配置格式不正确");
  if (!body || typeof body !== "object" || Object.keys(body).some((key) => key !== "apiKey" && !(key in parsed.data)) || ("apiKey" in body && typeof body.apiKey !== "string")) {
    return err("INVALID_BODY", 400, "渠道配置格式不正确");
  }
  const missing = await assertModelsRegistered(parsed.data.models.map((m) => m.public));
  if (missing.length) {
    return err("INVALID_BODY", 400, `以下模型尚未注册，请先在「模型与价格」中添加：${missing.join(", ")}`);
  }
  try {
    await validateUpstreamUrl(parsed.data.baseUrl);
  } catch {
    return err("INVALID_BASE_URL", 400, "渠道地址必须是可解析的 HTTPS 公网地址");
  }

  const { id } = await params;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  await connectMongo();
  const updated = await ChannelModel.findByIdAndUpdate(
    id,
    { $set: { ...parsed.data, ...(apiKey ? { apiKey } : {}) } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) return err("NOT_FOUND", 404, "渠道不存在");
  const { apiKey: _omit, ...channel } = updated;
  return NextResponse.json({ channel });
}
