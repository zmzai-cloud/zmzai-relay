import {it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
vi.mock("@/providers/auth/apikey",()=>({resolveApiKey:async()=>({allowedModels:["a"]})}));
vi.mock("@/providers/auth/session",()=>({getCurrentUser:async()=>null}));
vi.mock("@/providers/catalog/public-models",()=>({
 getPublicModels:async()=>[{model:"a",routable:true,maxInputTokens:1,maxOutputTokens:1,allowedReasoningEfforts:[]},{model:"b",routable:true,maxInputTokens:1,maxOutputTokens:1,allowedReasoningEfforts:[]}],
 getPublicChannels:async()=>[{channel:"one",models:[{model:"a",available:true},{model:"b",available:true}]},{channel:"two",models:[{model:"a",available:false}]}],
 getInternalModelSelectorData:async()=>({featured:[{id:"a"},{id:"b"}],channels:[{id:"one",name:"one",models:[{id:"a"},{id:"b"}]}]})
}));
import {GET} from "@/app/api/v1/models/route";
it("只返回密钥允许的模型，且健康渠道数量只计算可用渠道",async()=>{
 const r=await GET(new NextRequest("http://localhost/api/v1/models",{headers:{authorization:"Bearer token"}}));const data=await r.json();
 expect(data.models.map((m:{model:string;availableChannels:number})=>[m.model,m.availableChannels])).toEqual([["a",1]]);
 expect(data.modelSelectorData.featured.map((m:{id:string})=>m.id)).toEqual(["a"]);expect(data.modelSelectorData.channels[0].models.map((m:{id:string})=>m.id)).toEqual(["a"]);
});
