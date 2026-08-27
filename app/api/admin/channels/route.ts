import { type NextRequest, NextResponse } from "next/server";
import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { channelCreateSchema, assertModelsRegistered } from "@/providers/channels/schema";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { validateUpstreamUrl } from "@/providers/network/safe-upstream-fetch";

export const dynamic = "force-dynamic";

function err(code: string, status: number, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminRequiredError) return err("ADMIN_REQUIRED", 403, "需要管理员权限");
    throw e;
  }
  await connectMongo();
  // 不返回 apiKey 明文
  const channels = await ChannelModel.find().sort({ priority: 1 }).lean();
  return NextResponse.json({ channels });
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminRequiredError) return err("ADMIN_REQUIRED", 403, "需要管理员权限");
    throw e;
  }

  const body = await req.json().catch(() => null);
  const parsed = channelCreateSchema.safeParse(body);
  if (!parsed.success) {
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

  await connectMongo();
  const created = await ChannelModel.create({
    ...parsed.data,
    protocol: "openai-compat",
  });
  const { apiKey: _omit, ...safe } = created.toObject();
  return NextResponse.json({ channel: safe }, { status: 201 });
}
