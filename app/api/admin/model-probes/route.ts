import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { ModelProbeModel } from "@/providers/database/mongodb/models/model-probe";
import { probeFingerprint, probeModel } from "@/providers/catalog/model-probe";
import { recordModelFailure, recordModelSuccess } from "@/providers/channels/model-health";
const schema=z.object({channelId:z.string().refine(isValidObjectId),model:z.string().min(1).max(120)}).strict();
export async function POST(req:NextRequest) {
  try { await requireAdmin(); } catch(e) {if(e instanceof AdminRequiredError)return NextResponse.json({error:"需要管理员权限"},{status:403});throw e;}
  const input=schema.safeParse(await req.json().catch(()=>null));
  if(!input.success)return NextResponse.json({error:"请求格式不正确"},{status:400});
  await connectMongo(); const channel=await ChannelModel.findById(input.data.channelId).select("+apiKey").lean();
  const mapping=channel?.models.find(m=>m.public===input.data.model);
  if(!channel || !mapping)return NextResponse.json({error:"渠道中没有此模型"},{status:404});
  const config={baseUrl:channel.baseUrl,apiKey:channel.apiKey,upstreamModel:mapping.upstream,publicModel:mapping.public};
  const result=await probeModel(config);
  await ModelProbeModel.findOneAndUpdate({channelId:channel._id,publicModel:mapping.public},{$set:{upstreamModel:mapping.upstream,fingerprint:probeFingerprint(config),...result}},{upsert:true,new:true,runValidators:true});
  const key={channelId:channel._id,publicModel:mapping.public,fingerprint:probeFingerprint(config)};
  if(result.ok) await recordModelSuccess(key).catch(()=>console.error("记录模型健康状态失败"));
  else await recordModelFailure(key,{category:result.category==="other"?"upstream":result.category??"upstream",affectsHealth:result.category!=="other"||result.status<400||result.status>=500,retryAt:result.retryAt??null}).catch(()=>console.error("记录模型健康状态失败"));
  return NextResponse.json({result});
}
