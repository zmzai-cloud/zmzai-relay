import {describe,it,expect} from "vitest";
import {selectModelCandidates,summarizeModelHealth} from "@/providers/channels/model-routing";
import {probeFingerprint} from "@/providers/catalog/model-probe";
const now=new Date("2026-11-07T00:00:00Z");
const channels=[{_id:"c1",baseUrl:"https://one.example",apiKey:"key",models:[{public:"a",upstream:"up-a"},{public:"b",upstream:"up-b"}]},{_id:"c2",baseUrl:"https://two.example",apiKey:"key2",models:[{public:"a",upstream:"up-a"}]}];
const fingerprint=probeFingerprint({baseUrl:channels[0].baseUrl,apiKey:channels[0].apiKey,publicModel:"a",upstreamModel:"up-a"});
const health=[{channelId:"c1",publicModel:"a",fingerprint,category:"quota_exhausted" as const,cooldownUntil:new Date(now.getTime()+3600000)}];
describe("模型级路由",()=>{
 it("跳过额度用尽的渠道但不影响同渠道其他模型",()=>{
  expect(selectModelCandidates(channels,health,"a",now).available.map(c=>c._id)).toEqual(["c2"]);
  expect(selectModelCandidates(channels,health,"b",now).available.map(c=>c._id)).toEqual(["c1"]);
 });
 it("新密钥或过期冷却后不再沿用旧状态",()=>{
  expect(selectModelCandidates([{...channels[0],apiKey:"new"}],health,"a",now).available).toHaveLength(1);
  expect(selectModelCandidates(channels,health,"a",new Date(now.getTime()+3600001)).available).toHaveLength(2);
 });
 it("所有候选均受限时给出安全的原因和恢复时间",()=>{
  const result=selectModelCandidates([channels[0]],health,"a",now);expect(result.available).toHaveLength(0);expect(result.blocked[0].category).toBe("quota_exhausted");expect(result.blocked[0].cooldownUntil).toEqual(new Date(now.getTime()+3600000));
 });
 it("恢复探测进行中会暂时阻止并发请求",()=>{
  const probing=[{...health[0],cooldownUntil:new Date(now.getTime()-1000),leaseUntil:new Date(now.getTime()+60000)}];
  expect(selectModelCandidates([channels[0]],probing,"a",now).available).toHaveLength(0);
 });

 it("冷却到期后仍提醒管理员最近错误，直到恢复成功",()=>{
  const result=summarizeModelHealth(channels,health,new Date(now.getTime()+3600001));expect(result.blocked).toBe(0);expect(result.pending).toBe(1);
 });

});
