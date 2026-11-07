import {describe,it,expect,vi} from "vitest";
const prices=[{model:"m",enabled:true,inputPricePer1kMicros:101,outputPricePer1kMicros:500,cacheReadPricePer1kMicros:1,cacheWritePricePer1kMicros:0,maxInputTokens:1000,maxOutputTokens:100,allowedReasoningEfforts:[],featured:false,featuredDescription:""}];
const channels=[{_id:"c1",baseUrl:"https://one.example",apiKey:"key1",name:"高价",priority:1,executeMultiplier:2,models:[{public:"m",upstream:"m"}]},{_id:"c2",baseUrl:"https://two.example",apiKey:"key2",name:"折扣",priority:2,executeMultiplier:0.4,models:[{public:"m",upstream:"m"}]}];
vi.mock("@/providers/database/mongodb/models/model-price",()=>({ModelPriceModel:{find:()=>({lean:async()=>prices})}}));
vi.mock("@/providers/database/mongodb/models/channel",()=>({ChannelModel:{find:()=>({select:()=>({sort:()=>({lean:async()=>channels})})})}}));
vi.mock("@/providers/database/mongodb/models/model-health",()=>({ModelHealthModel:{find:()=>({select:()=>({lean:async()=>[]})})}}));
import {getPublicChannels} from "@/providers/catalog/public-models";
describe("公开渠道价格",()=>{it("展示每条渠道的实际扣费价格及缓存回退",async()=>{
 const list=await getPublicChannels();expect(list.map(c=>[c.channel,c.models[0].inputPricePer1kMicros,c.models[0].outputPricePer1kMicros,c.models[0].cacheReadPricePer1kMicros,c.models[0].cacheWritePricePer1kMicros])).toEqual([["高价",202,1000,2,202],["折扣",40,200,40,40]]);
});});
