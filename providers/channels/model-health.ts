import {randomUUID} from "node:crypto";
import type {Types} from "mongoose";
import {ModelHealthModel,type ModelHealthRecord} from "@/providers/database/mongodb/models/model-health";
import type {UpstreamError} from "@/providers/channels/upstream-errors";
const THRESHOLD=3, COOLDOWN_MS=5*60*1000;
export type ModelHealthKey={channelId:Types.ObjectId|string;publicModel:string;fingerprint:string;startedAt?:Date;leaseToken?:string};
type CoolingRecord=(Pick<ModelHealthRecord,"fingerprint"|"cooldownUntil"> & Partial<Pick<ModelHealthRecord,"leaseUntil">>)|null|undefined;
export function isModelCooling(health:CoolingRecord,fingerprint:string,now=new Date()):boolean {
 return Boolean(health&&health.fingerprint===fingerprint&&((health.cooldownUntil&&new Date(health.cooldownUntil).getTime()>now.getTime())||(health.leaseUntil&&new Date(health.leaseUntil).getTime()>now.getTime())));
}
function guardedQuery(key:ModelHealthKey, now:Date, kind:"success"|"failure") {
 const base={channelId:key.channelId,publicModel:key.publicModel};
 if(key.leaseToken) return {...base,fingerprint:key.fingerprint,leaseToken:key.leaseToken,leaseUntil:{$gt:now}};
 const guards:Record<string,unknown>[]=[{$or:[{fingerprint:{$ne:key.fingerprint}},{leaseUntil:null},{leaseUntil:{$lte:now}}]}];
 if(key.startedAt) {
  const field=kind==="success"?"lastFailureAt":"lastSuccessAt";
  guards.push({$or:[{[field]:null},{[field]:{$lte:key.startedAt}}]});
  if(kind==="success") guards.push({$or:[{lastSuccessAt:null},{lastSuccessAt:{$lte:key.startedAt}}]});
  else {
   guards.push({$or:[{cooldownUntil:null},{lastFailureAt:null},{lastFailureAt:{$lte:key.startedAt}}]});
   guards.push({$or:[{fingerprint:key.fingerprint},{lastFailureAt:null},{lastFailureAt:{$lte:key.startedAt}}]});
  }
 }
 return {...base,$and:guards};
}
export async function recordModelFailure(key:ModelHealthKey,failure:UpstreamError,now=new Date()):Promise<void> {
 if(!failure.affectsHealth)return;
 await ModelHealthModel.init();
 const same={$eq:["$fingerprint",{$literal:key.fingerprint}]};
 const count={$add:[{$cond:[same,{$ifNull:["$consecutiveFailures",0]},0]},1]};
 const next=failure.retryAt??{$cond:[{$gte:[count,THRESHOLD]},new Date(now.getTime()+COOLDOWN_MS),null]};
 const cooldown={$cond:[{$and:[same,{$gt:["$cooldownUntil",now]},{$or:[{$eq:[next,null]},{$gt:["$cooldownUntil",next]}]}]},"$cooldownUntil",next]};
 const query=guardedQuery(key,now,"failure");
 const pipeline=[{$set:{fingerprint:{$literal:key.fingerprint},consecutiveFailures:count,category:{$literal:failure.category},lastFailureCategory:{$literal:failure.category},lastFailureAt:now,lastSuccessAt:{$cond:[same,"$lastSuccessAt",null]},leaseUntil:null,leaseToken:null,cooldownUntil:cooldown}}];
 // Concurrent first observations can race on the unique key: retry the loser as an update.
 try {await ModelHealthModel.updateOne(query,pipeline,{upsert:!key.leaseToken})}catch(e){if((e as {code?:number}).code!==11000)throw e;await ModelHealthModel.updateOne(query,pipeline)}
}
export async function recordModelSuccess(key:ModelHealthKey,now=new Date()):Promise<void> {
 await ModelHealthModel.init();
 const query=guardedQuery(key,now,"success");
 const same={$eq:["$fingerprint",{$literal:key.fingerprint}]};
 const update=[{$set:{fingerprint:{$literal:key.fingerprint},consecutiveFailures:0,category:null,cooldownUntil:null,leaseUntil:null,leaseToken:null,lastSuccessAt:now,lastFailureAt:{$cond:[same,"$lastFailureAt",null]},lastFailureCategory:{$cond:[same,"$lastFailureCategory",null]}}}];
 try {await ModelHealthModel.updateOne(query,update,{upsert:!key.leaseToken})}catch(e){if((e as {code?:number}).code!==11000)throw e;await ModelHealthModel.updateOne(query,update)}
}

/** A single caller probes a model after its cooldown; other requests wait for the result. */
export type RecoveryLease={token:string;expiresAt:Date};
export async function claimModelRecovery(key:ModelHealthKey,now=new Date(),leaseMs=180000):Promise<RecoveryLease|null> {
 await ModelHealthModel.init();
 const expiresAt=new Date(now.getTime()+leaseMs),token=randomUUID();
 const result=await ModelHealthModel.findOneAndUpdate({channelId:key.channelId,publicModel:key.publicModel,fingerprint:key.fingerprint,cooldownUntil:{$lte:now},$or:[{leaseUntil:null},{leaseUntil:{$lte:now}}]},{$set:{leaseUntil:expiresAt,leaseToken:token}},{new:true}).lean();
 return result?{token,expiresAt}:null;
}
export async function renewModelRecovery(key:ModelHealthKey,token:string,now=new Date(),leaseMs=180000):Promise<boolean> {
 const result=await ModelHealthModel.updateOne({channelId:key.channelId,publicModel:key.publicModel,fingerprint:key.fingerprint,leaseToken:token,leaseUntil:{$gt:now}},{$set:{leaseUntil:new Date(now.getTime()+leaseMs)}});
 return result.matchedCount===1;
}
export async function releaseModelRecovery(key:ModelHealthKey,lease:RecoveryLease):Promise<void> {
 await ModelHealthModel.updateOne({channelId:key.channelId,publicModel:key.publicModel,fingerprint:key.fingerprint,leaseToken:lease.token},{$set:{leaseUntil:null,leaseToken:null}});
}
export function startRecoveryHeartbeat(key:ModelHealthKey,lease:RecoveryLease,leaseMs:number) {
 const controller=new AbortController(); let stopped=false, busy=false;
 const timer=setInterval(async()=>{
  if(stopped||busy)return; busy=true;
  try {if(!await renewModelRecovery(key,lease.token,new Date(),leaseMs)&&!stopped)controller.abort();}
  catch {if(!stopped)controller.abort();}
  finally {busy=false;}
 },Math.min(30000,Math.max(1000,Math.floor(leaseMs/3))));
 timer.unref?.();
 return {signal:controller.signal,stop(){stopped=true;clearInterval(timer)}};
}
