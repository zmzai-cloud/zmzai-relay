import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {spawn, type ChildProcess} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {once} from "node:events";
import mongoose from "mongoose";
vi.mock("@/providers/database/mongodb/connection",()=>({connectMongo:async()=>mongoose}));
import {saveDraft,publishDraft,getDraft,updateDraft,testDraftModel} from "@/providers/catalog/onboarding";
vi.mock("@/providers/network/safe-upstream-fetch",()=>({safeUpstreamFetch:async()=>Response.json({choices:[{message:{content:"ok"}}]})}));
import {ChannelModel} from "@/providers/database/mongodb/models/channel";
import {AdminAuditModel} from "@/providers/database/mongodb/models/admin-audit";
import {ModelPriceModel} from "@/providers/database/mongodb/models/model-price";
const admin=new mongoose.Types.ObjectId().toString(), port=29071, uri=`mongodb://127.0.0.1:${port}/relay_onboarding_test?replicaSet=relaytest`;
let dir:string;
const price={inputPricePer1kMicros:100,outputPricePer1kMicros:200,cacheReadPricePer1kMicros:0,cacheWritePricePer1kMicros:0,maxInputTokens:1000,maxOutputTokens:100,allowedReasoningEfforts:["low" as const]};
const model={publicModel:"new-model",upstreamModel:"upstream",mode:"new" as const,price,cost:null};
const draft=()=>({channel:{kind:"new" as const,name:"example",baseUrl:"https://example.com/v1",apiKey:"secret"},models:[model]});
let mongoProcess:ChildProcess;
beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),"relay-mongo-"));
 mongoProcess=spawn("mongod",["--dbpath",dir,"--port",String(port),"--bind_ip","127.0.0.1","--replSet","relaytest","--logpath",join(dir,"mongo.log")],{stdio:"ignore"});
 let direct:mongoose.mongo.MongoClient|undefined;
 for(let n=0;n<100;n++){try{direct=await mongoose.mongo.MongoClient.connect(`mongodb://127.0.0.1:${port}/?directConnection=true`,{serverSelectionTimeoutMS:200});break}catch{await new Promise(r=>setTimeout(r,100))}}
 if(!direct)throw new Error("test MongoDB failed to start");
 await direct.db("admin").command({replSetInitiate:{_id:"relaytest",members:[{_id:0,host:`127.0.0.1:${port}`}]}});await direct.close();
 await mongoose.connect(uri,{serverSelectionTimeoutMS:20000});
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
  const d=await saveDraft(admin,draft());await testDraftModel(admin,d.id,d.revision,"new-model");await publishDraft(admin,d.id,d.revision,false);expect(await ModelPriceModel.countDocuments()).toBe(1);
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

});
