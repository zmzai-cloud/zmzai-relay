import {describe,it,expect} from "vitest";
import {classifyUpstreamError} from "@/providers/channels/upstream-errors";
const now=new Date("2026-11-07T00:00:00Z");
describe("上游错误分类",()=>{
 it("将智谱周/月额度耗尽的 429 与普通限流区分",()=>{
  const quota=classifyUpstreamError(429,'{"error":{"code":"1310","message":"您已达到每周/每月使用上限"}}',null,now);
  expect(quota.category).toBe("quota_exhausted");expect(classifyUpstreamError(429,'{"error":{"code":"insufficient_quota"}}',null,now).category).toBe("quota_exhausted");expect(quota.retryAt?.getTime()).toBe(now.getTime()+60*60*1000);
  const rate=classifyUpstreamError(429,'{"error":{"message":"Too many requests"}}',"12",now);
  expect(rate.category).toBe("rate_limit");expect(rate.retryAt?.getTime()).toBe(now.getTime()+12000);
 });
 it("将余额、鉴权、上游故障和用户请求错误分开",()=>{
  expect(classifyUpstreamError(402,"",null,now).category).toBe("balance");
  expect(classifyUpstreamError(401,"",null,now).category).toBe("auth");
  expect(classifyUpstreamError(503,"",null,now).category).toBe("upstream");
  expect(classifyUpstreamError(400,"",null,now).affectsHealth).toBe(false);
 });
 it("限制异常 Retry-After，不解析没有时区的上游重置时间",()=>{
  const result=classifyUpstreamError(429,'{"error":{"message":"每周使用上限将在 2026-11-06 16:59:50 重置"}}',"99999999",now);
  expect(result.category).toBe("quota_exhausted");expect(result.retryAt?.getTime()).toBeLessThanOrEqual(now.getTime()+24*60*60*1000);
 });
 it("区分上游模型不存在与用户内容审核错误",()=>{
  const missing=classifyUpstreamError(404,'{"error":{"code":"model_not_found","message":"model does not exist"}}',null,now);expect(missing.category).toBe("model_unavailable");expect(missing.affectsHealth).toBe(true);
  const policy=classifyUpstreamError(403,'{"error":{"code":"content_policy_violation","message":"policy"}}',null,now);expect(policy.category).toBe("invalid_request");expect(policy.affectsHealth).toBe(false);
  const messageOnly=classifyUpstreamError(403,'{"error":{"message":"Your request violates our content policy"}}',null,now);expect(messageOnly.category).toBe("invalid_request");expect(messageOnly.affectsHealth).toBe(false);
 });

});
