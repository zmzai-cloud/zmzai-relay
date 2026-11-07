import {describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({health:[] as any[],result:{ok:false,category:"quota_exhausted",retryAt:new Date("2026-11-07T01:00:00Z"),status:429,latencyMs:10,testedAt:new Date("2026-11-07T00:00:00Z")}}));
vi.mock("@/providers/auth/session",()=>({AdminRequiredError:class extends Error{},requireAdmin:async()=>({id:"admin"})}));
vi.mock("@/providers/database/mongodb/connection",()=>({connectMongo:async()=>{}}));
vi.mock("@/providers/database/mongodb/models/channel",()=>({ChannelModel:{findById:()=>({select:()=>({lean:async()=>({_id:"channel",baseUrl:"https://example.com",apiKey:"secret",models:[{public:"a",upstream:"one"},{public:"b",upstream:"two"}]})})})}}));
vi.mock("@/providers/database/mongodb/models/model-probe",()=>({ModelProbeModel:{findOneAndUpdate:async()=>({})}}));
vi.mock("@/providers/catalog/model-probe",()=>({probeFingerprint:()=>"fp",probeModel:async()=>state.result}));
vi.mock("@/providers/channels/model-health",()=>({recordModelSuccess:async(k:any)=>state.health.push(k),recordModelFailure:async(k:any,e:any)=>state.health.push([k,e])}));
vi.mock("@/providers/network/safe-upstream-fetch",()=>({safeUpstreamFetch:async()=>Response.json({data:[]})}));
import {POST} from "@/app/api/admin/channels/[id]/test/route";
describe("渠道手动检测",()=>{it("只更新所测模型并返回安全错误分类",async()=>{
 state.health=[];const r=await POST(new NextRequest("http://localhost/",{method:"POST"}),{params:Promise.resolve({id:"a"})});const data=await r.json();expect(data.completion.error).toBe("quota_exhausted");expect(state.health[0][0].publicModel).toBe("a");expect(state.health[0][1].category).toBe("quota_exhausted");expect(JSON.stringify(data)).not.toContain("secret");
});});
