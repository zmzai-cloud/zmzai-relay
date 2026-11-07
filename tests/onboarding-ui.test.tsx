// @vitest-environment jsdom
import React from "react";
import {afterEach,describe,it,expect,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {OnboardingWizard} from "@/app/admin/models/onboarding-wizard";
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
const channels=[{id:"channel-id",name:"Existing",executeMultiplier:1}],existingModels:never[]=[];
describe("model onboarding",()=>{
 it("falls back to manual models when discovery fails",async()=>{
  vi.stubGlobal("fetch",vi.fn(async(input:string)=>input.endsWith("/models")?new Response(JSON.stringify({error:"无法读取"}),{status:502}):Response.json({drafts:[]})));
  render(<OnboardingWizard channels={channels} existingModels={existingModels}/>);
  fireEvent.click(screen.getByRole("button",{name:"添加模型"}));
  fireEvent.click(screen.getByRole("button",{name:"读取上游模型"}));
  await screen.findByText(/无法读取/);
  fireEvent.change(screen.getByLabelText("手动输入上游模型"),{target:{value:"custom-model"}});
  fireEvent.click(screen.getByRole("button",{name:"添加"}));
  expect(screen.getByLabelText("上游模型 ID")).toBeTruthy();
 });
 it("shows the matching existing-model price after changing its ID",()=>{
  const base={inputPricePer1kMicros:1000,outputPricePer1kMicros:2000,cacheReadPricePer1kMicros:0,cacheWritePricePer1kMicros:0,maxInputTokens:128000,maxOutputTokens:4096,allowedReasoningEfforts:["low"]};
  const prices=[{...base,model:"first"},{...base,model:"second",inputPricePer1kMicros:9000}];
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({drafts:[]})));render(<OnboardingWizard channels={channels} existingModels={prices}/>);fireEvent.click(screen.getByRole("button",{name:"添加模型"}));fireEvent.change(screen.getByLabelText("手动输入上游模型"),{target:{value:"first"}});fireEvent.click(screen.getByRole("button",{name:"添加"}));
  expect((screen.getByLabelText("输入售价") as HTMLInputElement).value).toBe("1");fireEvent.change(screen.getByLabelText("对外模型 ID"),{target:{value:"second"}});expect((screen.getByLabelText("输入售价") as HTMLInputElement).value).toBe("9");
 });

 it("offers a new channel without exposing saved credentials",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({drafts:[]})));
  render(<OnboardingWizard channels={channels} existingModels={existingModels}/>);fireEvent.click(screen.getByRole("button",{name:"添加模型"}));
  fireEvent.change(screen.getByLabelText("选择渠道"),{target:{value:"new"}});
  expect(screen.getByLabelText("渠道名称")).toBeTruthy();expect((screen.getByLabelText("上游 API Key") as HTMLInputElement).type).toBe("password");
 });
 it("fills known official prices by a chosen multiplier",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({drafts:[]})));render(<OnboardingWizard channels={channels} existingModels={existingModels}/>);fireEvent.click(screen.getByRole("button",{name:"添加模型"}));
  fireEvent.change(screen.getByLabelText("手动输入上游模型"),{target:{value:"deepseek-v4-flash"}});fireEvent.click(screen.getByRole("button",{name:"添加"}));
  fireEvent.change(screen.getByLabelText("价格倍率"),{target:{value:"2"}});fireEvent.click(screen.getByRole("button",{name:"按官方价填充"}));
  expect((screen.getByLabelText("输入售价") as HTMLInputElement).value).toBe("6");expect((screen.getByLabelText("输出售价") as HTMLInputElement).value).toBe("18");
 });

});
describe("draft workflow",()=>{
 it("validates prices before saving, then tests each model independently and reports conflicts",async()=>{
  let stored:unknown;
  const fetcher=vi.fn(async(input:string,init?:RequestInit)=>{
   if(input==="/api/admin/onboarding"&&!init)return Response.json({drafts:[]});
   if(input==="/api/admin/onboarding"&&init){stored=JSON.parse(String(init.body));return Response.json({draft:{id:"draft1",revision:1,payload:stored}})}
   if(input.endsWith("/test")){const model=JSON.parse(String(init?.body)).model;return Response.json({result:{ok:model==="first",category:model==="first"?null:"balance"}})}
   if(input.endsWith("/publish"))return Response.json({error:"渠道配置已变更，请重新检查"},{status:409});
   return Response.json({drafts:[]});
  });vi.stubGlobal("fetch",fetcher);vi.stubGlobal("confirm",vi.fn(()=>true));
  render(<OnboardingWizard channels={channels} existingModels={existingModels}/>);fireEvent.click(screen.getByRole("button",{name:"添加模型"}));
  for(const model of ["first","second"]){fireEvent.change(screen.getByLabelText("手动输入上游模型"),{target:{value:model}});fireEvent.click(screen.getByRole("button",{name:"添加"}));}
  fireEvent.change(screen.getAllByLabelText("输入售价")[0],{target:{value:"1.0001"}});fireEvent.click(screen.getByRole("button",{name:"保存草稿"}));expect((await screen.findByRole("alert")).textContent).toContain("价格精度");
  for(const item of screen.getAllByLabelText("输入售价"))fireEvent.change(item,{target:{value:"1"}});
  for(const item of screen.getAllByLabelText("输出售价"))fireEvent.change(item,{target:{value:"2"}});
  fireEvent.click(screen.getByRole("button",{name:"保存草稿"}));await screen.findByText(/草稿已保存/);
  fireEvent.click(screen.getAllByRole("button",{name:"测试此模型"})[0]);await screen.findByText("测试通过");
  fireEvent.click(screen.getAllByRole("button",{name:"测试此模型"})[1]);await screen.findByText("上游余额不足");
  fireEvent.click(screen.getByRole("button",{name:"确认上线"}));expect((await screen.findByRole("alert")).textContent).toContain("渠道配置已变更");
 });
 it("lets administrators inspect and apply changed live configuration",async()=>{
  const saved={id:"draft1",revision:1,payload:{channel:{kind:"existing",id:"channel-id"},models:[]},probes:[]};
  const view={token:"token",channelChanged:true,currentChannel:{name:"Existing",baseUrl:"https://example.com",priority:10,executeMultiplier:1,enabled:true},models:[]};
  vi.stubGlobal("fetch",vi.fn(async(input:string,init?:RequestInit)=>input.includes("/rebase")?Response.json(init?{draft:{...saved,revision:2}}:{review:view}):Response.json(input.endsWith("draft1")?{draft:saved}:{drafts:[saved]})));
  render(<OnboardingWizard channels={channels} existingModels={existingModels}/>);fireEvent.click(screen.getByRole("button",{name:"添加模型"}));await waitFor(()=>expect(screen.getByLabelText("恢复草稿")).toBeTruthy());fireEvent.change(screen.getByLabelText("恢复草稿"),{target:{value:"draft1"}});await screen.findByText("已载入草稿");
  fireEvent.click(screen.getByRole("button",{name:"检查线上变化"}));await screen.findByText(/渠道配置已变化/);fireEvent.click(screen.getByRole("button",{name:"确认使用最新配置"}));await screen.findByText(/已更新草稿/);
 });

 it("saves a draft before prices are filled",async()=>{
  let payload:Record<string,unknown>|undefined;vi.stubGlobal("fetch",vi.fn(async(input:string,init?:RequestInit)=>{if(init){payload=JSON.parse(String(init.body));return Response.json({draft:{id:"draft1",revision:1,payload}})}return Response.json({drafts:[]})}));
  render(<OnboardingWizard channels={channels} existingModels={existingModels}/>);fireEvent.click(screen.getByRole("button",{name:"添加模型"}));fireEvent.change(screen.getByLabelText("手动输入上游模型"),{target:{value:"first"}});fireEvent.click(screen.getByRole("button",{name:"添加"}));fireEvent.click(screen.getByRole("button",{name:"保存草稿"}));await screen.findByText(/草稿已保存/);expect(JSON.stringify(payload)).toContain('"inputPricePer1kMicros":null');fireEvent.click(screen.getByRole("button",{name:"确认上线"}));expect((await screen.findByRole("alert")).textContent).toContain("请填写输入及输出价格");
 });

 it("restores a draft without putting its saved key in the password field",async()=>{
  const saved={id:"draft1",revision:2,payload:{channel:{kind:"new",name:"Test",baseUrl:"https://example.com"},models:[]},probes:[]};
  vi.stubGlobal("fetch",vi.fn(async(input:string)=>Response.json(input.endsWith("draft1")?{draft:saved}:{drafts:[saved]})));
  render(<OnboardingWizard channels={channels} existingModels={existingModels}/>);fireEvent.click(screen.getByRole("button",{name:"添加模型"}));
  await waitFor(()=>expect(screen.getByLabelText("恢复草稿")).toBeTruthy());fireEvent.change(screen.getByLabelText("恢复草稿"),{target:{value:"draft1"}});
  await screen.findByText("已载入草稿");expect((screen.getByLabelText("上游 API Key") as HTMLInputElement).value).toBe("");
 });
});
