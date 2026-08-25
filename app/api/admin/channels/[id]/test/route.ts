import { type NextRequest, NextResponse } from "next/server";

import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { safeUpstreamFetch } from "@/providers/network/safe-upstream-fetch";

export const dynamic = "force-dynamic";

function err(code: string, status: number, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** 双段探测：先 /models 验证连通性，再用渠道第一个模型映射做最小 completion 验证真实推理链路。
 *  /models 探测通过 ≠ 推理可用（上游中转站的模型列表与推理端点可能处于不同状态，
 *  曾出现 /models 全通但 chat/completions 全 503），必须以 completion 结果为准。 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminRequiredError) return err("ADMIN_REQUIRED", 403, "需要管理员权限");
    throw e;
  }

  const { id } = await params;
  await connectMongo();
  const channel = await ChannelModel.findById(id).select("+apiKey").lean();
  if (!channel) {
    return err("NOT_FOUND", 404, "渠道不存在");
  }

  const baseUrl = channel.baseUrl.replace(/\/$/, "");
  const startedAt = Date.now();

  // 第一段：/models 快速连通性探测（网络/认证/服务可达）。
  let models: { ok: boolean; status: number; latencyMs: number; error?: string } | null = null;
  try {
    const res = await safeUpstreamFetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${channel.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    models = { ok: res.ok, status: res.status, latencyMs: Date.now() - startedAt };
  } catch (e) {
    models = { ok: false, status: 0, latencyMs: Date.now() - startedAt, error: e instanceof Error ? e.message : "connect failed" };
  }

  // 第二段：真实推理探测。
  const model = channel.models[0]?.upstream;
  if (!model) {
    return NextResponse.json({ ok: models.ok, models, completion: null });
  }
  const completionStartedAt = Date.now();
  try {
    const completion = await safeUpstreamFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${channel.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      signal: AbortSignal.timeout(20000),
    });
    return NextResponse.json({
      ok: completion.ok,
      models,
      completion: { ok: completion.ok, status: completion.status, latencyMs: Date.now() - completionStartedAt, model },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      models,
      completion: { ok: false, status: 0, latencyMs: Date.now() - completionStartedAt, model, error: e instanceof Error ? e.message : "connect failed" },
    });
  }
}
