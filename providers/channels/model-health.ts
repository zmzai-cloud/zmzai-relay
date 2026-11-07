import type {Types} from "mongoose";
import {ModelHealthModel,type ModelHealthRecord} from "@/providers/database/mongodb/models/model-health";
import type {UpstreamError} from "@/providers/channels/upstream-errors";
const THRESHOLD=3, COOLDOWN_MS=5*60*1000;
export type ModelHealthKey={channelId:Types.ObjectId|string;publicModel:string;fingerprint:string};
type CoolingRecord=(Pick<ModelHealthRecord,"fingerprint"|"cooldownUntil"> & Partial<Pick<ModelHealthRecord,"leaseUntil">>)|null|undefined;
export function isModelCooling(health:CoolingRecord,fingerprint:string,now=new Date()):boolean {
 return Boolean(health&&health.fingerprint===fingerprint&&((health.cooldownUntil&&new Date(health.cooldownUntil).getTime()>now.getTime())||(health.leaseUntil&&new Date(health.leaseUntil).getTime()>now.getTime())));
}
export async function recordModelFailure(key:ModelHealthKey,failure:UpstreamError,now=new Date()):Promise<void> {
 if(!failure.affectsHealth)return;
 await ModelHealthModel.init();
 const same={$eq:["$fingerprint",{$literal:key.fingerprint}]};
 const count={$add:[{$cond:[same,{$ifNull:["$consecutiveFailures",0]},0]},1]};
 const next=failure.retryAt??{$cond:[{$gte:[count,THRESHOLD]},new Date(now.getTime()+COOLDOWN_MS),null]};
 const cooldown={$cond:[{$and:[same,{$gt:["$cooldownUntil",now]},{$or:[{$eq:[next,null]},{$gt:["$cooldownUntil",next]}]}]},"$cooldownUntil",next]};
 const query={channelId:key.channelId,publicModel:key.publicModel};
 const pipeline=[{$set:{fingerprint:{$literal:key.fingerprint},consecutiveFailures:count,category:{$literal:failure.category},lastFailureCategory:{$literal:failure.category},lastFailureAt:now,lastSuccessAt:{$cond:[same,"$lastSuccessAt",null]},leaseUntil:null,cooldownUntil:cooldown}}];
 // Concurrent first observations can race on the unique key: retry the loser as an update.
 try {await ModelHealthModel.updateOne(query,pipeline,{upsert:true})}catch(e){if((e as {code?:number}).code!==11000)throw e;await ModelHealthModel.updateOne(query,pipeline)}
}
export async function recordModelSuccess(key:ModelHealthKey,now=new Date()):Promise<void> {
 await ModelHealthModel.init();
 const query={channelId:key.channelId,publicModel:key.publicModel};
 const same={$eq:["$fingerprint",{$literal:key.fingerprint}]};
 const update=[{$set:{fingerprint:{$literal:key.fingerprint},consecutiveFailures:0,category:null,cooldownUntil:null,leaseUntil:null,lastSuccessAt:now,lastFailureAt:{$cond:[same,"$lastFailureAt",null]},lastFailureCategory:{$cond:[same,"$lastFailureCategory",null]}}}];
 try {await ModelHealthModel.updateOne(query,update,{upsert:true})}catch(e){if((e as {code?:number}).code!==11000)throw e;await ModelHealthModel.updateOne(query,update)}
}

/** A single caller probes a model after its cooldown; other requests wait for the result. */
export async function claimModelRecovery(key:ModelHealthKey,now=new Date(),leaseMs=180000):Promise<Date|null> {
 await ModelHealthModel.init();
 const deadline=new Date(now.getTime()+leaseMs);
 const result=await ModelHealthModel.findOneAndUpdate({channelId:key.channelId,publicModel:key.publicModel,fingerprint:key.fingerprint,cooldownUntil:{$lte:now},$or:[{leaseUntil:null},{leaseUntil:{$lte:now}}]},{$set:{leaseUntil:deadline}},{new:true}).lean();
 return result?deadline:null;
}
/** Release only the lease owned by this request, never a newer one. */
export async function releaseModelRecovery(key:ModelHealthKey,deadline:Date):Promise<void> {
 await ModelHealthModel.updateOne({channelId:key.channelId,publicModel:key.publicModel,fingerprint:key.fingerprint,leaseUntil:deadline},{$set:{leaseUntil:null}});
}
