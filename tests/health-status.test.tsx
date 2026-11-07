import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {it,expect} from "vitest";
import {ModelHealthStatus} from "@/app/admin/models/model-health-status";
it("将额度阻断与最近成功、下次尝试时间区分展示",()=>{
 const html=renderToStaticMarkup(<ModelHealthStatus now={new Date("2026-11-07T00:00:00Z")} health={{category:"quota_exhausted",lastFailureCategory:"quota_exhausted",cooldownUntil:new Date("2026-11-07T01:00:00Z"),lastSuccessAt:new Date("2026-11-06T23:00:00Z"),lastFailureAt:new Date("2026-11-07T00:00:00Z"),consecutiveFailures:1}}/>);
 expect(html).toContain("额度已用尽");expect(html).toContain("下次尝试");expect(html).toContain("最近成功");expect(html).toContain("最近失败");
});

it("恢复检测进行中不显示为已经恢复",()=>{
 const html=renderToStaticMarkup(<ModelHealthStatus now={new Date("2026-11-07T00:00:00Z")} health={{category:"quota_exhausted",lastFailureCategory:"quota_exhausted",cooldownUntil:new Date("2026-11-06T23:59:00Z"),leaseUntil:new Date("2026-11-07T00:02:00Z"),lastSuccessAt:null,lastFailureAt:new Date("2026-11-06T23:00:00Z"),consecutiveFailures:1}}/>);expect(html).toContain("正在检测恢复");expect(html).not.toContain("最近调用成功");
});
