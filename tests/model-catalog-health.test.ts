import {describe,it,expect,vi} from "vitest";
import {probeFingerprint} from "@/providers/catalog/model-probe";
const channel={_id:"c1",name:"渠道",baseUrl:"https://example.com",apiKey:"key",priority:1,executeMultiplier:1,models:[{public:"a",upstream:"up-a"},{public:"b",upstream:"up-b"}]};
const price=(model:string)=>({model,enabled:true,inputPricePer1kMicros:100,outputPricePer1kMicros:200,cacheReadPricePer1kMicros:0,cacheWritePricePer1kMicros:0,maxInputTokens:1000,maxOutputTokens:100,allowedReasoningEfforts:[],featured:false,featuredDescription:""});
const fingerprint=probeFingerprint({baseUrl:channel.baseUrl,apiKey:channel.apiKey,publicModel:"a",upstreamModel:"up-a"});
const state=vi.hoisted(()=>({health:[] as any[]}));
vi.mock("@/providers/database/mongodb/models/model-price",()=>({ModelPriceModel:{find:()=>({lean:async()=>[price("a"),price("b")],sort:()=>({lean:async()=>[price("a"),price("b")]})})}}));
vi.mock("@/providers/database/mongodb/models/channel",()=>({ChannelModel:{find:()=>({select:()=>({sort:()=>({lean:async()=>[channel]})}),sort:()=>({lean:async()=>[channel]})})}}));
vi.mock("@/providers/database/mongodb/models/model-health",()=>({ModelHealthModel:{find:()=>({select:()=>({lean:async()=>state.health})})}}));
import {getPublicChannels,getPublicModels,getInternalModelSelectorData} from "@/providers/catalog/public-models";
describe("模型目录健康状态",()=>{it("展示冷却状态但不向调用选择器提供受限模型",async()=>{
 state.health=[{channelId:"c1",publicModel:"a",fingerprint,category:"quota_exhausted",cooldownUntil:new Date(Date.now()+3600000)}];
 const channels=await getPublicChannels();expect(channels[0].models.map(m=>[m.model,m.available])).toEqual([["a",false],["b",true]]);
 expect((await getPublicModels()).find(m=>m.model==="a")?.routable).toBe(false);
 expect((await getInternalModelSelectorData()).channels[0].models.map(m=>m.id)).toEqual(["b"]);
});});
