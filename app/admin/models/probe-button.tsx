"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {healthLabels as labels} from "@/providers/channels/health-labels";
export type ProbeDisplay = {ok:boolean;category:string|null;testedAt:string;stale:boolean} | null;
export function ProbeButton({channelId,model,initial}:{channelId:string;model:string;initial:ProbeDisplay}) {
 const router=useRouter();
 const [result,setResult]=useState(initial),[loading,setLoading]=useState(false),[error,setError]=useState("");
 async function test(){setLoading(true);setError("");try{const response=await fetch("/api/admin/model-probes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channelId,model})});const body=await response.json();if(!response.ok)throw new Error(body.error||"测试失败");setResult({...body.result,stale:false});router.refresh();}catch(e){setError(e instanceof Error?e.message:"测试失败")}finally{setLoading(false)}}
 const label=!result?"未测试":result.stale?"配置已更改，需重新测试":result.ok?"可用":labels[result.category||"other"]||"测试失败";
 return <div className="flex flex-wrap items-center gap-2"><span className="text-xs" title={result?.testedAt||undefined} aria-live="polite">{label}</span><button type="button" onClick={test} disabled={loading} className="text-xs text-accent underline underline-offset-4 disabled:opacity-50">{loading?"测试中…":"测试"}</button>{error?<span role="alert" className="text-xs text-danger">{error}</span>:null}</div>;
}
