import { type NextRequest, NextResponse } from "next/server";

import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { safeUpstreamFetch } from "@/providers/network/safe-upstream-fetch";
import { recordModelSuccess, recordModelFailure } from "@/providers/channels/model-health";
import { ModelProbeModel } from "@/providers/database/mongodb/models/model-probe";
import { probeModel, probeFingerprint } from "@/providers/catalog/model-probe";

export const dynamic = "force-dynamic";

function err(code: string, status: number, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** 双段探测：先 /models 验证连通性，再用渠道第一个模型映射做最小 completion 验证真实推理链路。
 *  /models 探测通过 ≠ 推理可用（上游中转站的模型列表与推理端点可能处于不同状态，
 *  曾出现 /models 全通但 chat/completions 全 503），必须以 completion 结果为准。
 *  completion 结果联动渠道健康度：成功清零计数并解除冷却（手动救活），失败计入连续失败。 */
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

  // 第二段：测试第一个模型，结果只影响该模型的路由状态。
  const mapping=channel.models[0];
  if (!mapping) return NextResponse.json({ ok: models.ok, models, completion: null });
  const config={baseUrl:channel.baseUrl,apiKey:channel.apiKey,publicModel:mapping.public,upstreamModel:mapping.upstream};
  const probeStartedAt=new Date();
  const result=await probeModel(config),fingerprint=probeFingerprint(config);
  await ModelProbeModel.findOneAndUpdate({channelId:channel._id,publicModel:mapping.public},{$set:{upstreamModel:mapping.upstream,fingerprint,...result}},{upsert:true,new:true,runValidators:true});
  const key={channelId:channel._id,publicModel:mapping.public,fingerprint,startedAt:probeStartedAt};
  if(result.ok) await recordModelSuccess(key).catch(()=>console.error("记录模型健康状态失败"));
  else await recordModelFailure(key,{category:result.category==="other"?"upstream":result.category??"upstream",affectsHealth:result.category!=="other"||result.status<400||result.status>=500,retryAt:result.retryAt}).catch(()=>console.error("记录模型健康状态失败"));
  return NextResponse.json({ok:result.ok,models,completion:{ok:result.ok,status:result.status,latencyMs:result.latencyMs,model:mapping.upstream,...(!result.ok?{error:result.category??"other"}:{})}});
}
