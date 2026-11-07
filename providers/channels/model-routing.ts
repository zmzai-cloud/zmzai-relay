import {probeFingerprint} from "@/providers/catalog/model-probe";
import {isModelCooling} from "@/providers/channels/model-health";
import type {UpstreamErrorCategory} from "@/providers/channels/upstream-errors";
export type RoutingChannel={_id:unknown;baseUrl:string;apiKey:string;models:Array<{public:string;upstream:string}>};
export type RoutingHealth={channelId:unknown;publicModel:string;fingerprint:string;category:UpstreamErrorCategory|null;cooldownUntil:Date|null;leaseUntil?:Date|null};
export function selectModelCandidates<T extends RoutingChannel>(channels:T[],health:RoutingHealth[],model:string,now=new Date()) {
 const byChannel=new Map(health.filter(h=>h.publicModel===model).map(h=>[String(h.channelId),h]));
 const available:T[]=[];const blocked:RoutingHealth[]=[];
 for(const channel of channels){
  const mapping=channel.models.find(m=>m.public===model);if(!mapping)continue;
  const h=byChannel.get(String(channel._id));
  const fingerprint=probeFingerprint({baseUrl:channel.baseUrl,apiKey:channel.apiKey,publicModel:model,upstreamModel:mapping.upstream});
  if(h&&isModelCooling(h,fingerprint,now))blocked.push(h);else available.push(channel);
 }
 return {available,blocked};
}

/** Actionable states remain visible after cooldown expires until a real success clears them. */
export function summarizeModelHealth(channels:Array<RoutingChannel & {enabled?:boolean}>,health:RoutingHealth[],now=new Date()) {
 let blocked=0,pending=0;const blockedByChannel=new Map<string,number>();
 const channelMap=new Map(channels.filter(c=>c.enabled!==false).map(c=>[String(c._id),c]));
 for(const h of health){
  const channel=channelMap.get(String(h.channelId));const mapping=channel?.models.find(m=>m.public===h.publicModel);
  if(!channel||!mapping||!h.category)continue;
  const fingerprint=probeFingerprint({baseUrl:channel.baseUrl,apiKey:channel.apiKey,publicModel:mapping.public,upstreamModel:mapping.upstream});
  if(h.fingerprint!==fingerprint)continue;
  if(isModelCooling(h,fingerprint,now)){blocked++;const id=String(channel._id);blockedByChannel.set(id,(blockedByChannel.get(id)??0)+1)}else pending++;
 }
 return {blocked,pending,blockedByChannel};
}
