import {NextRequest,NextResponse} from "next/server";
import {isValidObjectId} from "mongoose";
import {z} from "zod";
import {requireAdmin} from "@/providers/auth/session";
import {connectMongo} from "@/providers/database/mongodb/connection";
import {OnboardingDraftModel} from "@/providers/database/mongodb/models/onboarding-draft";
import {ChannelModel} from "@/providers/database/mongodb/models/channel";
import {safeUpstreamFetch,validateUpstreamUrl} from "@/providers/network/safe-upstream-fetch";
import {failure} from "../common";
const schema=z.discriminatedUnion("kind",[z.object({kind:z.literal("existing"),id:z.string().refine(isValidObjectId)}).strict(),z.object({kind:z.literal("draft"),id:z.string().refine(isValidObjectId)}).strict(),z.object({kind:z.literal("new"),baseUrl:z.string().url().max(500),apiKey:z.string().min(1).max(2000)}).strict()]);
export async function POST(req:NextRequest){
 try {
  const admin=await requireAdmin();const input=schema.parse(await req.json());let baseUrl:string,apiKey:string;
  if(input.kind==="existing"){await connectMongo();const channel=await ChannelModel.findById(input.id).select("+apiKey").lean();if(!channel)return NextResponse.json({error:"渠道不存在"},{status:404});({baseUrl,apiKey}=channel)}else if(input.kind==="draft"){await connectMongo();const draft=await OnboardingDraftModel.findOne({_id:input.id,ownerId:admin.id,published:false}).select("+secret").lean();const channel=draft?.payload.channel as {kind?:string;baseUrl?:string}|undefined;if(!draft||channel?.kind!=="new"||!channel.baseUrl||!draft.secret)return NextResponse.json({error:"草稿或渠道不存在"},{status:404});baseUrl=channel.baseUrl;apiKey=draft.secret;}else{({baseUrl,apiKey}=input);await validateUpstreamUrl(baseUrl)}
  const upstream=await safeUpstreamFetch(`${baseUrl.replace(/\/$/,"")}/models`,{headers:{Authorization:`Bearer ${apiKey}`},connectTimeoutMs:10000,signal:AbortSignal.timeout(15000)});
  if(!upstream.ok)return NextResponse.json({error:"无法读取上游模型列表，可以手动添加"},{status:502});
  const reader=upstream.body?.getReader();if(!reader)throw new Error("empty response");const chunks:Uint8Array[]=[];let size=0;
  for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>1048576){await reader.cancel();throw new Error("response too large")}chunks.push(item.value)}
  const data=JSON.parse(Buffer.concat(chunks).toString("utf8"));const models=Array.isArray(data?.data)?[...new Set<string>(data.data.map((x:{id?:unknown})=>x?.id).filter((x:unknown):x is string=>typeof x==="string"&&x.length>0&&x.length<=200))].slice(0,500):[];
  return NextResponse.json({models});
 }catch(e){return failure(e)}
}
