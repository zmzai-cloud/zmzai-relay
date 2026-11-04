import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state=vi.hoisted(()=>({admin:true, mappings:[{public:"model",upstream:"up"}], saved:null as unknown}));
vi.mock("@/providers/auth/session",()=>({AdminRequiredError:class extends Error{},requireAdmin:async()=>{if(!state.admin) throw new (await import("@/providers/auth/session")).AdminRequiredError(); return {id:"admin"}}}));
vi.mock("@/providers/database/mongodb/connection",()=>({connectMongo:async()=>{}}));
vi.mock("@/providers/database/mongodb/models/channel",()=>({ChannelModel:{findById:()=>({select:()=>({lean:async()=>({name:"channel",baseUrl:"https://example.com",apiKey:"very-secret",models:state.mappings})})})}}));
vi.mock("@/providers/database/mongodb/models/model-probe",()=>({ModelProbeModel:{findOneAndUpdate:async(...args:unknown[])=>{state.saved=args;return {}}}}));
vi.mock("@/providers/catalog/model-probe",()=>({probeFingerprint:()=>"fingerprint",probeModel:async()=>({ok:true,category:null,status:200,latencyMs:2,testedAt:new Date("2026-01-01")})}));
import { POST } from "@/app/api/admin/model-probes/route";
function req(model="model"){return new NextRequest("http://localhost/api/admin/model-probes",{method:"POST",body:JSON.stringify({channelId:"aaaaaaaaaaaaaaaaaaaaaaaa",model})})}
describe("probe endpoint",()=>{
 it("rejects a non-admin",async()=>{state.admin=false;expect((await POST(req())).status).toBe(403);state.admin=true});
 it("rejects a model not configured on the channel",async()=>{expect((await POST(req("missing"))).status).toBe(404)});
 it("stores only sanitized result, not credentials",async()=>{const r=await POST(req());expect(r.status).toBe(200);expect(JSON.stringify(await r.json())).not.toContain("very-secret");expect(JSON.stringify(state.saved)).not.toContain("very-secret")});
});
