import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {spawn, type ChildProcess} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {once} from "node:events";
import {createServer} from "node:net";
import mongoose from "mongoose";
vi.mock("@/providers/database/mongodb/connection",()=>({connectMongo:async()=>mongoose}));
import {saveDraft,publishDraft,getDraft,updateDraft,testDraftModel,draftSchema,inspectDraftChanges,rebaseDraft} from "@/providers/catalog/onboarding";
const sync=vi.hoisted(()=>({hold:false,waiting:0,release:undefined as (()=>void)|undefined}));
vi.mock("@/providers/network/safe-upstream-fetch",()=>({validateUpstreamUrl:async(input:string)=>{const u=new URL(input);if(u.protocol!=="https:"||u.username||u.password||u.hostname==="127.0.0.1")throw new Error("渠道地址不安全")},safeUpstreamFetch:async()=>{if(sync.hold){sync.waiting++;if(sync.waiting===2)sync.release?.();else await new Promise<void>(r=>sync.release=r)}return Response.json({choices:[{message:{role:"assistant",content:"ok"}}]})}}));
import {ChannelModel} from "@/providers/database/mongodb/models/channel";
import {recordModelFailure,recordModelSuccess,isModelCooling,claimModelRecovery} from "@/providers/channels/model-health";
import {ModelHealthModel} from "@/providers/database/mongodb/models/model-health";
import {classifyUpstreamError} from "@/providers/channels/upstream-errors";
import {ModelProbeModel} from "@/providers/database/mongodb/models/model-probe";
import {AdminAuditModel} from "@/providers/database/mongodb/models/admin-audit";
import {ModelPriceModel} from "@/providers/database/mongodb/models/model-price";
const admin=new mongoose.Types.ObjectId().toString();
let port:number;
let dir:string;
const price={inputPricePer1kMicros:100,outputPricePer1kMicros:200,cacheReadPricePer1kMicros:0,cacheWritePricePer1kMicros:0,maxInputTokens:1000,maxOutputTokens:100,allowedReasoningEfforts:["low" as const]};
const model={publicModel:"new-model",upstreamModel:"upstream",mode:"new" as const,price,cost:null};
const draft=()=>({channel:{kind:"new" as const,name:"example",baseUrl:"https://example.com/v1",apiKey:"secret"},models:[model]});
let mongoProcess:ChildProcess;
beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),"relay-mongo-"));
 const socket=createServer();await new Promise<void>((resolve,reject)=>{socket.once("error",reject);socket.listen(0,"127.0.0.1",resolve)});port=(socket.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>socket.close(e=>e?reject(e):resolve()));
 mongoProcess=spawn("mongod",["--dbpath",dir,"--port",String(port),"--bind_ip","127.0.0.1","--replSet","relaytest","--logpath",join(dir,"mongo.log")],{stdio:"ignore"});
 let direct:mongoose.mongo.MongoClient|undefined;
 for(let n=0;n<100;n++){try{direct=await mongoose.mongo.MongoClient.connect(`mongodb://127.0.0.1:${port}/?directConnection=true`,{serverSelectionTimeoutMS:200});break}catch{await new Promise(r=>setTimeout(r,100))}}
 if(!direct)throw new Error("test MongoDB failed to start");
 const status=await direct.db("admin").command({serverStatus:1});if(status.pid!==mongoProcess.pid){await direct.close();throw new Error("refusing to use an unrelated MongoDB process")}
 await direct.db("admin").command({replSetInitiate:{_id:"relaytest",members:[{_id:0,host:`127.0.0.1:${port}`}]}});await direct.close();
 await mongoose.connect(`mongodb://127.0.0.1:${port}/relay_onboarding_test?replicaSet=relaytest`,{serverSelectionTimeoutMS:20000});
},30000);
afterAll(async()=>{await mongoose.disconnect();if(mongoProcess && mongoProcess.exitCode===null){const done=once(mongoProcess,"exit");mongoProcess.kill("SIGTERM");await done}rmSync(dir,{recursive:true,force:true})},30000);
beforeEach(async()=>{await mongoose.connection.db!.dropDatabase()});
describe("isolated onboarding",()=>{
 it("saves a draft without creating live models or channels; publishes only after confirmation",async()=>{const d=await saveDraft(admin,draft());expect(await ChannelModel.countDocuments()).toBe(0);expect(await ModelPriceModel.countDocuments()).toBe(0);await expect(publishDraft(admin,d.id,d.revision,false)).rejects.toThrow(/测试/);await publishDraft(admin,d.id,d.revision,true);expect(await ChannelModel.countDocuments()).toBe(1);expect(await ModelPriceModel.countDocuments({model:"new-model"})).toBe(1);await expect(publishDraft(admin,d.id,d.revision,true)).rejects.toThrow();});
 it("adds a mapping without changing an existing model's pricing or availability",async()=>{await ModelPriceModel.create({model:"existing",...price,enabled:true,publicVisible:false});const c=await ChannelModel.create({name:"existing",baseUrl:"https://example.com/v1",apiKey:"secret",models:[{public:"old-model",upstream:"old"}],enabled:true});const d=await saveDraft(admin,{channel:{kind:"existing",id:String(c._id)},models:[{...model,publicModel:"existing",mode:"existing"}]});await publishDraft(admin,d.id,d.revision,true);const p=await ModelPriceModel.findOne({model:"existing"}).lean();expect(p?.publicVisible).toBe(false);expect(p?.inputPricePer1kMicros).toBe(100);expect((await ChannelModel.findById(c._id).lean())?.models).toHaveLength(2);});
 it("rejects concurrent changes and preserves the draft",async()=>{const c=await ChannelModel.create({name:"existing",baseUrl:"https://example.com/v1",apiKey:"secret",models:[],enabled:true});const d=await saveDraft(admin,{channel:{kind:"existing",id:String(c._id)},models:[model]});await ChannelModel.findByIdAndUpdate(c._id,{$set:{priority:99}});await expect(publishDraft(admin,d.id,d.revision,true)).rejects.toThrow(/变更/);expect(await ModelPriceModel.countDocuments()).toBe(0);});
 it("invalidates tests when credentials change and never returns secrets",async()=>{
  const d=await saveDraft(admin,draft());expect(JSON.stringify(await getDraft(admin,d.id))).not.toContain("secret");
  await testDraftModel(admin,d.id,d.revision,"new-model");
  const changed=draft();changed.channel.apiKey="new-secret";const updated=await updateDraft(admin,d.id,d.revision,changed);
  await expect(publishDraft(admin,d.id,updated.revision,false)).rejects.toThrow(/测试/);
  expect(await ModelPriceModel.countDocuments()).toBe(0);
 });
 it("publishes a tested configuration without an untested override",async()=>{
  const d=await saveDraft(admin,draft());await testDraftModel(admin,d.id,d.revision,"new-model");const published=await publishDraft(admin,d.id,d.revision,false);expect(await ModelPriceModel.countDocuments()).toBe(1);expect((await ModelProbeModel.findOne({channelId:published.channelId,publicModel:"new-model"}).lean())?.ok).toBe(true);
 });
 it("rejects stale draft revisions and mismatched mode",async()=>{
  const d=await saveDraft(admin,draft());await expect(publishDraft(admin,d.id,99,true)).rejects.toThrow(/草稿/);
  await expect(saveDraft(admin,{...draft(),models:[{...model,mode:"existing"}]})).rejects.toThrow(/模型/);
 });

 it("rolls back every live write if audit fails",async()=>{
  const d=await saveDraft(admin,draft());const spy=vi.spyOn(AdminAuditModel,"create").mockRejectedValueOnce(new Error("injected failure"));
  try{await expect(publishDraft(admin,d.id,d.revision,true)).rejects.toThrow("injected failure");expect(await ModelPriceModel.countDocuments()).toBe(0);expect(await ChannelModel.countDocuments()).toBe(0);expect((await getDraft(admin,d.id)).published).toBe(false)}finally{spy.mockRestore()}
 });

 it("marks saved test stale if an existing channel changes",async()=>{
  const c=await ChannelModel.create({name:"existing",baseUrl:"https://example.com/v1",apiKey:"secret",models:[],enabled:true});
  const d=await saveDraft(admin,{channel:{kind:"existing",id:String(c._id)},models:[model]});await testDraftModel(admin,d.id,d.revision,"new-model");
  await ChannelModel.findByIdAndUpdate(c._id,{$set:{apiKey:"changed"}});
  const read=await getDraft(admin,d.id);expect(read.probes[0].stale).toBe(true);expect(JSON.stringify(read)).not.toContain("changed");
 });

 it("preserves results of simultaneous tests of different models",async()=>{
  const d=await saveDraft(admin,{...draft(),models:[model,{...model,publicModel:"second",upstreamModel:"second"}]});sync.hold=true;sync.waiting=0;
  try{await Promise.all([testDraftModel(admin,d.id,d.revision,"new-model"),testDraftModel(admin,d.id,d.revision,"second")]);const read=await getDraft(admin,d.id);expect(read.probes.map(p=>p.model).sort()).toEqual(["new-model","second"])}finally{sync.hold=false;sync.waiting=0;sync.release=undefined}
 });

 it("rejects unsafe input prices on the server",()=>{
  const bad=draft();bad.models[0]={...bad.models[0],price:{...price,inputPricePer1kMicros:1e100}};
  expect(draftSchema.safeParse(bad).success).toBe(false);
 });
 it("rejects execution multipliers that make the effective price unsafe",async()=>{
  const c=await ChannelModel.create({name:"high-multiplier",baseUrl:"https://example.com",apiKey:"secret",models:[],executeMultiplier:100,enabled:true});
  const huge={...model,price:{...price,inputPricePer1kMicros:Math.floor(Number.MAX_SAFE_INTEGER/2)}};
  const d=await saveDraft(admin,{channel:{kind:"existing",id:String(c._id)},models:[huge]});
  await expect(publishDraft(admin,d.id,d.revision,true)).rejects.toThrow(/价格/);expect(await ModelPriceModel.countDocuments()).toBe(0);
 });

 it("saves incomplete drafts without publishing unfinished models",async()=>{
  const empty={...draft(),models:[]};const a=await saveDraft(admin,empty);expect((await getDraft(admin,a.id)).payload.models).toEqual([]);await expect(publishDraft(admin,a.id,a.revision,true)).rejects.toThrow();
  const partial={...draft(),models:[{...model,price:{...price,inputPricePer1kMicros:null,outputPricePer1kMicros:null}}]};
  const b=await saveDraft(admin,partial);expect(await ModelPriceModel.countDocuments()).toBe(0);await expect(publishDraft(admin,b.id,b.revision,true)).rejects.toThrow();
 });

 it.each(["http://127.0.0.1/v1","https://user:pass@example.com/v1"])("rejects unsafe new channel URL %s",async(url)=>{
  const data=draft();data.channel.baseUrl=url;await expect(saveDraft(admin,data)).rejects.toThrow(/渠道地址/);expect(await ChannelModel.countDocuments()).toBe(0);
 });

 it("does not mistake channel health counters for a configuration conflict",async()=>{
  const c=await ChannelModel.create({name:"existing",baseUrl:"https://example.com/v1",apiKey:"secret",models:[],enabled:true});
  const d=await saveDraft(admin,{channel:{kind:"existing",id:String(c._id)},models:[model]});await ChannelModel.findByIdAndUpdate(c._id,{$inc:{consecutiveFailures:1}});
  await publishDraft(admin,d.id,d.revision,true);expect(await ModelPriceModel.countDocuments()).toBe(1);
 });

 it("allows explicit inspection and rebase of a conflicted draft",async()=>{
  const c=await ChannelModel.create({name:"existing",baseUrl:"https://example.com/v1",apiKey:"secret",models:[],enabled:true});const d=await saveDraft(admin,{channel:{kind:"existing",id:String(c._id)},models:[model]});
  await ChannelModel.findByIdAndUpdate(c._id,{$set:{priority:42}});const review=await inspectDraftChanges(admin,d.id,d.revision);expect(review.channelChanged).toBe(true);expect(JSON.stringify(review)).not.toContain("secret");
  const rebased=await rebaseDraft(admin,d.id,d.revision,review.token);expect(rebased.revision).toBe(d.revision+1);await publishDraft(admin,d.id,rebased.revision,true);expect(await ModelPriceModel.countDocuments()).toBe(1);
 });
 it("rejects a rebase when the live configuration changes after inspection",async()=>{
  const c=await ChannelModel.create({name:"existing",baseUrl:"https://example.com/v1",apiKey:"secret",models:[],enabled:true});const d=await saveDraft(admin,{channel:{kind:"existing",id:String(c._id)},models:[model]});
  const review=await inspectDraftChanges(admin,d.id,d.revision);await ChannelModel.findByIdAndUpdate(c._id,{$set:{priority:33}});await expect(rebaseDraft(admin,d.id,d.revision,review.token)).rejects.toThrow(/变更/);
 });

 it("isolates cooldown and recovery for each channel/model pair",async()=>{
  await ModelHealthModel.createIndexes();const channelId=new mongoose.Types.ObjectId();const config={channelId,publicModel:"a",fingerprint:"one"};
  const failure=classifyUpstreamError(503,"",null);await Promise.all([1,2,3].map(()=>recordModelFailure(config,failure)));
  const a=await ModelHealthModel.findOne({channelId,publicModel:"a"}).select("+fingerprint").lean();expect(a?.consecutiveFailures).toBe(3);expect(isModelCooling(a,"one")).toBe(true);expect(isModelCooling(a,"new-config")).toBe(false);
  expect(await ModelHealthModel.findOne({channelId,publicModel:"b"})).toBeNull();await recordModelSuccess({...config,publicModel:"b"});expect(isModelCooling(await ModelHealthModel.findOne({channelId,publicModel:"a"}).select("+fingerprint").lean(),"one")).toBe(true);
  await recordModelSuccess(config);const recovered=await ModelHealthModel.findOne({channelId,publicModel:"a"}).select("+fingerprint").lean();expect(isModelCooling(recovered,"one")).toBe(false);expect(recovered?.lastSuccessAt).toBeTruthy();
 });
 it("immediately pauses quota failures but never counts invalid user input",async()=>{
  const config={channelId:new mongoose.Types.ObjectId(),publicModel:"a",fingerprint:"one"};await recordModelFailure(config,classifyUpstreamError(400,"",null));expect(await ModelHealthModel.countDocuments()).toBe(0);
  await recordModelFailure(config,classifyUpstreamError(429,'{"error":{"code":"1310"}}',null));const h=await ModelHealthModel.findOne({channelId:config.channelId,publicModel:"a"}).select("+fingerprint").lean();expect(h?.category).toBe("quota_exhausted");expect(isModelCooling(h,"one")).toBe(true);
 });

 it("does not carry old-credential failure history into the new configuration",async()=>{
  const key={channelId:new mongoose.Types.ObjectId(),publicModel:"a",fingerprint:"old"};await recordModelFailure(key,classifyUpstreamError(503,"",null));
  await recordModelSuccess({...key,fingerprint:"new"});const h=await ModelHealthModel.findOne({channelId:key.channelId,publicModel:"a"}).select("+fingerprint").lean();expect(h?.lastFailureAt??null).toBeNull();expect(h?.lastSuccessAt).toBeTruthy();
 });

 it("allows only one recovery probe after a quota cooldown expires",async()=>{
  await ModelHealthModel.createIndexes();const now=new Date();const key={channelId:new mongoose.Types.ObjectId(),publicModel:"a",fingerprint:"one"};await recordModelFailure(key,classifyUpstreamError(429,'{"error":{"code":"1310"}}',null,now),now);
  const later=new Date(now.getTime()+3600001);const claims=await Promise.all(Array.from({length:10},()=>claimModelRecovery(key,later,60000)));expect(claims.filter(Boolean)).toHaveLength(1);
  expect(await claimModelRecovery(key,new Date(later.getTime()+60001),60000)).toBeTruthy();
 });

});
