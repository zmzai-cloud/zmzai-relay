import {beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({channels:[] as any[],health:[] as any[],calls:[] as string[],failures:[] as any[],successes:[] as any[],attempts:[] as any[],settlements:[] as any[],quotaFirst:false,invalidFirst:false,streamNoUsage:false,allowRecovery:false,claims:0,releases:0}));
vi.mock("@/providers/auth/session",()=>({getCurrentUser:async()=>({id:"user",name:"User"})}));
vi.mock("@/providers/database/mongodb/connection",()=>({connectMongo:async()=>{}}));
vi.mock("@/providers/database/mongodb/models/model-price",()=>({reasoningEfforts:["low"],ModelPriceModel:{findOne:()=>({lean:async()=>({model:"m",enabled:true,allowedReasoningEfforts:["low"],maxOutputTokens:100,maxInputTokens:1000,inputPricePer1kMicros:100,outputPricePer1kMicros:200,cacheReadPricePer1kMicros:0,cacheWritePricePer1kMicros:0})})}}));
vi.mock("@/providers/database/mongodb/models/usage",()=>({UsageModel:{findOne:()=>({lean:async()=>null}),create:async()=>({_id:"usage"}),updateOne:async()=>({})}}));
vi.mock("@/providers/database/mongodb/models/channel",()=>({ChannelModel:{find:()=>({select:()=>({sort:()=>({lean:async()=>state.channels})})})},resolveChannelCosts:()=>null}));
vi.mock("@/providers/database/mongodb/models/model-health",()=>({ModelHealthModel:{find:()=>({select:()=>({lean:async()=>state.health})})}}));
vi.mock("@/providers/database/mongodb/models/channel-attempt",()=>({ChannelAttemptModel:{create:async(v:any)=>{state.attempts.push(v)}}}));
vi.mock("@/providers/channels/model-health",()=>({isModelCooling:(h:any,f:string,now:Date)=>Boolean(h&&h.fingerprint===f&&new Date(h.cooldownUntil)>now),claimModelRecovery:async()=>{state.claims++;return state.allowRecovery?{token:"lease",expiresAt:new Date(Date.now()+60000)}:null},releaseModelRecovery:async()=>{state.releases++},startRecoveryHeartbeat:()=>({signal:new AbortController().signal,stop:()=>{}}),recordModelFailure:async(...v:any[])=>{state.failures.push(v)},recordModelSuccess:async(...v:any[])=>{state.successes.push(v)}}));
vi.mock("@/providers/billing/service",()=>({BillingError:class extends Error{},chargeMicros:()=>1,maximumChargeMicros:()=>1,reserveBalance:async()=>{},releaseReservation:async()=>{},settleReservation:async(...v:any[])=>{state.settlements.push(v)}}));
vi.mock("@/providers/network/safe-upstream-fetch",()=>({safeUpstreamFetch:async(url:string)=>{state.calls.push(url);if(state.streamNoUsage)return new Response("data: [DONE]\n\n",{status:200,headers:{"Content-Type":"text/event-stream"}});if(state.invalidFirst)return new Response("invalid",{status:400});if(state.quotaFirst&&url.includes("one.example"))return new Response('{"error":{"code":"1310","message":"每周使用上限","secret":"do-not-log"}}',{status:429});return Response.json({choices:[{message:{role:"assistant",content:"ok"}}],usage:{prompt_tokens:1,completion_tokens:1}})}}));
import {probeFingerprint} from "@/providers/catalog/model-probe";
import {POST} from "@/app/api/v1/chat/completions/route";
const channels=[{_id:"c1",baseUrl:"https://one.example",apiKey:"key",models:[{public:"m",upstream:"up"}],executeMultiplier:1,timeoutMs:1000},{_id:"c2",baseUrl:"https://two.example",apiKey:"key2",models:[{public:"m",upstream:"up"}],executeMultiplier:2,timeoutMs:1000}];
const req=()=>new NextRequest("http://localhost/api/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"m",messages:[{role:"user",content:"hi"}]})});
const blocked=()=>({channelId:"c1",publicModel:"m",fingerprint:probeFingerprint({baseUrl:channels[0].baseUrl,apiKey:channels[0].apiKey,publicModel:"m",upstreamModel:"up"}),category:"quota_exhausted",cooldownUntil:new Date(Date.now()+3600000)});
beforeEach(()=>{state.channels=channels;state.health=[];state.calls=[];state.failures=[];state.successes=[];state.attempts=[];state.settlements=[];state.quotaFirst=false;state.allowRecovery=false;state.invalidFirst=false;state.streamNoUsage=false;state.claims=0;state.releases=0});
describe("调用链的模型级健康路由",()=>{
 it("跳过受限渠道，使用正常渠道并按其倍率结算",async()=>{state.health=[blocked()];const r=await POST(req());expect(r.status).toBe(200);expect(state.calls).toEqual(["https://two.example/chat/completions"]);expect(state.settlements[0][1].inputPricePer1kMicros).toBe(200)});
 it("分类额度错误后尝试下一个渠道，不记录原始敏感错误",async()=>{state.quotaFirst=true;const r=await POST(req());expect(r.status).toBe(200);expect(state.failures[0][1].category).toBe("quota_exhausted");expect(state.calls).toHaveLength(2);expect(JSON.stringify(state.attempts)).not.toContain("do-not-log")});
 it("所有渠道额度用尽时不再调用上游并提示稍后恢复",async()=>{state.channels=[channels[0]];state.health=[blocked()];const r=await POST(req());expect(r.status).toBe(503);expect((await r.json()).code).toBe("UPSTREAM_QUOTA_EXHAUSTED");expect(r.headers.get("retry-after")).toBeTruthy();expect(state.calls).toHaveLength(0)});
 it("只让取得恢复检测资格的请求重新探测到期模型",async()=>{state.channels=[channels[0]];state.health=[{...blocked(),cooldownUntil:new Date(Date.now()-1000)}];const r=await POST(req());expect(r.status).toBe(503);expect(state.claims).toBe(1);expect(state.calls).toHaveLength(0)});

 it("恢复检测遇到用户参数错误时释放检测锁，不惩罚其他请求",async()=>{state.channels=[channels[0]];state.health=[{...blocked(),cooldownUntil:new Date(Date.now()-1000)}];state.allowRecovery=true;state.invalidFirst=true;const r=await POST(req());expect(r.status).toBe(400);expect(state.releases).toBe(1);expect(state.failures).toHaveLength(0)});

 it("流式恢复检测缺少用量时释放检测锁",async()=>{state.channels=[channels[0]];state.health=[{...blocked(),cooldownUntil:new Date(Date.now()-1000)}];state.allowRecovery=true;state.streamNoUsage=true;const r=await POST(new NextRequest("http://localhost/api/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"m",stream:true,messages:[{role:"user",content:"hi"}]})}));await r.text();expect(state.releases).toBe(1)});

});
