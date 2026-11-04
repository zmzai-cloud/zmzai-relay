import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { ModelPriceModel, reasoningEfforts } from "@/providers/database/mongodb/models/model-price";
import { OnboardingDraftModel } from "@/providers/database/mongodb/models/onboarding-draft";
import { probeFingerprint, probeModel } from "@/providers/catalog/model-probe";
import { AdminAuditModel } from "@/providers/database/mongodb/models/admin-audit";
const price=z.object({inputPricePer1kMicros:z.number().int().min(0),outputPricePer1kMicros:z.number().int().min(0),cacheReadPricePer1kMicros:z.number().int().min(0),cacheWritePricePer1kMicros:z.number().int().min(0),maxInputTokens:z.number().int().min(1).max(2000000),maxOutputTokens:z.number().int().min(1).max(500000),allowedReasoningEfforts:z.array(z.enum(reasoningEfforts)).min(1)}).strict();
const cost=z.object({inputCostPer1kTokensMicros:z.number().int().min(0),outputCostPer1kTokensMicros:z.number().int().min(0),cacheReadCostPer1kTokensMicros:z.number().int().min(0).optional(),cacheWriteCostPer1kTokensMicros:z.number().int().min(0).optional()}).strict().nullable();
export const draftSchema=z.object({channel:z.discriminatedUnion("kind",[z.object({kind:z.literal("existing"),id:z.string().refine(mongoose.isValidObjectId)}).strict(),z.object({kind:z.literal("new"),name:z.string().trim().min(1).max(80),baseUrl:z.string().url().max(500),apiKey:z.string().min(1).max(2000)}).strict()]),models:z.array(z.object({publicModel:z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i).max(120),upstreamModel:z.string().trim().min(1).max(200),mode:z.enum(["new","existing"]),price,cost}).strict()).min(1).max(50)}).strict().refine(v=>new Set(v.models.map(m=>m.publicModel)).size===v.models.length,{message:"模型名重复"});
export type DraftInput=z.infer<typeof draftSchema>;
type Snapshot={channelUpdatedAt:string|null;prices:Record<string,string|null>};
function cleanDraft(doc:{_id:mongoose.Types.ObjectId;revision:number;payload:Record<string,unknown>;published:boolean}) {return {id:String(doc._id),revision:doc.revision,payload:doc.payload,published:doc.published};}
export async function saveDraft(adminId:string, input:DraftInput) {
 const data=draftSchema.parse(input);await connectMongo();
 const channel=data.channel.kind==="existing"?await ChannelModel.findById(data.channel.id).lean():null;
 if(data.channel.kind==="existing"&&!channel)throw new Error("渠道不存在");
 if(data.channel.kind==="new"&&await ChannelModel.exists({name:data.channel.name}))throw new Error("渠道名称已存在");
 const existing=await ModelPriceModel.find({model:{$in:data.models.map(m=>m.publicModel)}}).lean();
 const prices:Record<string,string|null>={};
 for(const m of data.models){const p=existing.find(x=>x.model===m.publicModel);if((m.mode==="existing")!==Boolean(p))throw new Error(`模型 ${m.publicModel} 已变更，请重新选择`);prices[m.publicModel]=p?p.updatedAt.toISOString():null;}
 const snapshots:Snapshot={channelUpdatedAt:channel?.updatedAt.toISOString()??null,prices};
 const secret=data.channel.kind==="new"?data.channel.apiKey:undefined;
 const payload={...data,channel:data.channel.kind==="new"?{kind:"new",name:data.channel.name,baseUrl:data.channel.baseUrl}:data.channel};
 const doc=await OnboardingDraftModel.create({ownerId:adminId,revision:1,payload,secret,snapshots,published:false});return cleanDraft(doc);
}
export async function publishDraft(adminId:string,draftId:string,expectedRevision:number,acceptUntested:boolean) {
 await connectMongo(); const session=await mongoose.startSession(); let publishedId="";
 try {await session.withTransaction(async()=>{
  const d=await OnboardingDraftModel.findOne({_id:draftId,ownerId:adminId,published:false,revision:expectedRevision}).select("+secret").session(session).lean();
  if(!d)throw new Error("草稿不存在或已变更");
  const raw=d.payload as unknown as DraftInput; const input=draftSchema.parse({...raw,channel:raw.channel.kind==="new"?{...raw.channel,apiKey:d.secret}:raw.channel});const snap=d.snapshots as unknown as Snapshot;
  const savedChannel=input.channel.kind==="existing"?await ChannelModel.findById(input.channel.id).select("+apiKey").session(session).lean():null;
  if(input.channel.kind==="existing"&&!savedChannel)throw new Error("渠道配置已变更，请重新检查");
  const channelConfig=input.channel.kind==="new"?input.channel:{baseUrl:savedChannel!.baseUrl,apiKey:savedChannel!.apiKey};
  const verified=input.models.every(m=>d.probes?.some(p=>p.model===m.publicModel&&p.ok&&p.fingerprint===probeFingerprint({baseUrl:channelConfig.baseUrl,apiKey:channelConfig.apiKey,publicModel:m.publicModel,upstreamModel:m.upstreamModel})));
  if(!acceptUntested&&!verified)throw new Error("尚未通过测试，请确认后上线");
  const prices=await ModelPriceModel.find({model:{$in:input.models.map(m=>m.publicModel)}}).session(session).lean();
  for(const m of input.models){const p=prices.find(x=>x.model===m.publicModel);if((p?.updatedAt.toISOString()??null)!==snap.prices[m.publicModel])throw new Error("模型配置已变更，请重新检查");}
  let channel;
  if(input.channel.kind==="existing"){
   channel=await ChannelModel.findById(input.channel.id).session(session).lean();
   if(!channel||channel.updatedAt.toISOString()!==snap.channelUpdatedAt)throw new Error("渠道配置已变更，请重新检查");
   if(input.models.some(m=>channel!.models.some((x:{public:string})=>x.public===m.publicModel)))throw new Error("渠道已有同名模型映射");
  } else {
   if(await ChannelModel.exists({name:input.channel.name}).session(session))throw new Error("渠道名称已变更");
  }
  for(const m of input.models) {
   if(m.mode==="new") await ModelPriceModel.create([{model:m.publicModel,...m.price,enabled:true,publicVisible:true}],{session});
   else {const p=prices.find(x=>x.model===m.publicModel)!;const locked=await ModelPriceModel.updateOne({_id:p._id,updatedAt:p.updatedAt},{$inc:{__v:1}},{session});if(locked.matchedCount!==1)throw new Error("模型配置已变更，请重新检查");}
  }
  const mappings=input.models.map(m=>({public:m.publicModel,upstream:m.upstreamModel}));
  const modelCosts=Object.fromEntries(input.models.filter(m=>m.cost!==null).map(m=>[m.publicModel,m.cost]));
  if(channel){const result=await ChannelModel.updateOne({_id:channel._id,updatedAt:channel.updatedAt},{$push:{models:{$each:mappings}},$set:{modelCosts:{...(channel.modelCosts??{}),...modelCosts}}},{session});if(result.modifiedCount!==1)throw new Error("渠道配置已变更");publishedId=String(channel._id);}
  else {if(input.channel.kind!=="new")throw new Error("渠道不存在");const [created]=await ChannelModel.create([{name:input.channel.name,baseUrl:input.channel.baseUrl,apiKey:input.channel.apiKey,models:mappings,modelCosts,enabled:true}],{session});publishedId=String(created._id);}
  const done=await OnboardingDraftModel.updateOne({_id:d._id,revision:expectedRevision,published:false},{$set:{published:true},$unset:{secret:1}},{session});if(done.modifiedCount!==1)throw new Error("草稿已变更");
  await AdminAuditModel.create([{operatorUserId:adminId,resourceType:"model_onboarding",resourceId:String(d._id),before:null,after:{channelId:publishedId,models:input.models.map(m=>m.publicModel)},reason:"模型上线"}],{session});
 });return {channelId:publishedId};}finally{await session.endSession();}
}
export async function listDrafts(adminId:string) {
 await connectMongo();const docs=await OnboardingDraftModel.find({ownerId:adminId,published:false}).sort({updatedAt:-1}).limit(50).lean();return docs.map(d=>({...cleanDraft(d),probes:d.probes?.map(({fingerprint,...p})=>p)??[]}));
}
export async function getDraft(adminId:string,id:string) {
 await connectMongo();const d=await OnboardingDraftModel.findOne({_id:id,ownerId:adminId,published:false}).select("+secret").lean();if(!d)throw new Error("草稿不存在");
 const payload=d.payload as unknown as DraftInput;
 const channel=payload.channel.kind==="existing"?await ChannelModel.findById(payload.channel.id).select("+apiKey").lean():null;
 const baseUrl=payload.channel.kind==="existing"?channel?.baseUrl:payload.channel.baseUrl;
 const apiKey=payload.channel.kind==="existing"?channel?.apiKey:d.secret;
 const probes=(d.probes??[]).map(({fingerprint,...p})=>{const m=payload.models.find(x=>x.publicModel===p.model);return {...p,stale:!m||!baseUrl||!apiKey||fingerprint!==probeFingerprint({baseUrl,apiKey,publicModel:p.model,upstreamModel:m.upstreamModel})}});
 return {...cleanDraft(d),probes};
}
export async function updateDraft(adminId:string,id:string,revision:number,input:unknown) {
 await connectMongo();const old=await OnboardingDraftModel.findOne({_id:id,ownerId:adminId,published:false,revision}).select("+secret").lean();if(!old)throw new Error("草稿已变更");
 const candidate=input as {channel?:{kind?:string;apiKey?:string}};
 if(candidate?.channel?.kind==="new"&&!candidate.channel.apiKey)candidate.channel.apiKey=old.secret;
 const data=draftSchema.parse(input);const snap=old.snapshots as unknown as Snapshot;
 const oldChannel=(old.payload as {channel:{kind:string;id?:string}}).channel;
 if(oldChannel.kind==="existing") {const current=await ChannelModel.findById(oldChannel.id).lean();if(!current||current.updatedAt.toISOString()!==snap.channelUpdatedAt)throw new Error("渠道配置已变更，请重新检查");}
 const oldPrices=await ModelPriceModel.find({model:{$in:Object.keys(snap.prices)}}).lean();
 for(const [name,version] of Object.entries(snap.prices)){const p=oldPrices.find(x=>x.model===name);if((p?.updatedAt.toISOString()??null)!==version)throw new Error("模型配置已变更，请重新检查");}
 const channel=data.channel.kind==="existing"?await ChannelModel.findById(data.channel.id).lean():null;
 if(data.channel.kind==="existing"&&!channel)throw new Error("渠道不存在");
 if(data.channel.kind==="new"&&await ChannelModel.exists({name:data.channel.name}))throw new Error("渠道名称已存在");
 const rows=await ModelPriceModel.find({model:{$in:data.models.map(m=>m.publicModel)}}).lean();const prices:Record<string,string|null>={};
 for(const m of data.models){const p=rows.find(x=>x.model===m.publicModel);if((m.mode==="existing")!==Boolean(p))throw new Error(`模型 ${m.publicModel} 已变更`);prices[m.publicModel]=p?p.updatedAt.toISOString():null;}
 const payload={...data,channel:data.channel.kind==="new"?{kind:"new",name:data.channel.name,baseUrl:data.channel.baseUrl}:data.channel};
 const updated=await OnboardingDraftModel.findOneAndUpdate({_id:id,ownerId:adminId,published:false,revision},{$set:{payload,probes:[],snapshots:{channelUpdatedAt:channel?.updatedAt.toISOString()??null,prices},secret:data.channel.kind==="new"?data.channel.apiKey:undefined},$inc:{revision:1}},{new:true}).lean();if(!updated)throw new Error("草稿已变更");return cleanDraft(updated);
}
export async function testDraftModel(adminId:string,id:string,revision:number,model:string) {
 await connectMongo();const d=await OnboardingDraftModel.findOne({_id:id,ownerId:adminId,published:false,revision}).select("+secret").lean();if(!d)throw new Error("草稿已变更");
 const payload=d.payload as unknown as DraftInput;const m=payload.models.find(x=>x.publicModel===model);if(!m)throw new Error("模型不存在");
 const channel=payload.channel.kind==="existing"?await ChannelModel.findById(payload.channel.id).select("+apiKey").lean():null;
 if(payload.channel.kind==="existing"&&!channel)throw new Error("渠道不存在");
 const config={baseUrl:channel?.baseUrl??(payload.channel.kind==="new"?payload.channel.baseUrl:""),apiKey:channel?.apiKey??d.secret??"",publicModel:m.publicModel,upstreamModel:m.upstreamModel};
 const result=await probeModel(config);const probes=[...(d.probes??[]).filter(p=>p.model!==model),{model,fingerprint:probeFingerprint(config),...result}];
 const changed=await OnboardingDraftModel.updateOne({_id:id,ownerId:adminId,published:false,revision},{$set:{probes}});if(!changed.matchedCount)throw new Error("草稿已变更");return result;
}
