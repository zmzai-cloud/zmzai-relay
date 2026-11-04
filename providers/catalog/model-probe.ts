import { createHmac } from "node:crypto";
import { safeUpstreamFetch } from "@/providers/network/safe-upstream-fetch";
export type ProbeCategory = "auth" | "balance" | "rate_limit" | "upstream" | "timeout" | "other";
export type ProbeInput = {baseUrl:string;apiKey:string;upstreamModel:string;publicModel:string};
export type ProbeResult = {ok:boolean;category:ProbeCategory|null;status:number;latencyMs:number;testedAt:Date};
// Store a digest, never the credential; keep the fingerprint server-side.
export function probeFingerprint(input:ProbeInput):string {
  return createHmac("sha256", input.apiKey).update(JSON.stringify([input.baseUrl,input.publicModel,input.upstreamModel])).digest("hex");
}
export async function probeModel(input:ProbeInput):Promise<ProbeResult> {
  const start=Date.now(); let status=0; let ok=false; let category:ProbeCategory|null=null;
  try {
    const res=await safeUpstreamFetch(`${input.baseUrl.replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${input.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:input.upstreamModel,messages:[{role:"user",content:"Reply OK"}],max_tokens:64,stream:false}),connectTimeoutMs:20000,signal:AbortSignal.timeout(30000)});
    status=res.status;
    if (res.ok) { const data=await res.json().catch(()=>null); ok=Array.isArray(data?.choices)&&data.choices.length>0; if(!ok) category="other"; }
    else category=status===401||status===403?"auth":status===402?"balance":status===429?"rate_limit":status>=500?"upstream":"other";
  } catch(e) { category=e instanceof Error && /timeout|timed out|abort/i.test(e.message)?"timeout":"other"; }
  return {ok,category,status,latencyMs:Date.now()-start,testedAt:new Date()};
}
