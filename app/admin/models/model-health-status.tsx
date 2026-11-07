import type {ModelHealthRecord} from "@/providers/database/mongodb/models/model-health";
import {healthLabels} from "@/providers/channels/health-labels";
type DisplayHealth=Pick<ModelHealthRecord,"category"|"lastFailureCategory"|"cooldownUntil"|"lastSuccessAt"|"lastFailureAt"|"consecutiveFailures"> & Partial<Pick<ModelHealthRecord,"leaseUntil">>;
const time=(value:Date)=>new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
export function ModelHealthStatus({health,now=new Date()}:{health:DisplayHealth|null;now?:Date}) {
 if(!health)return <span className="text-xs text-muted">暂无调用记录</span>;
 const cooling=Boolean(health.cooldownUntil&&new Date(health.cooldownUntil).getTime()>now.getTime());
 const recovering=Boolean(health.leaseUntil&&new Date(health.leaseUntil).getTime()>now.getTime());
 const reason=health.category?healthLabels[health.category]??"上游异常":null;
 return <div className="space-y-1 text-xs"><p className={cooling?"font-medium text-danger":"text-ink-2"}>{cooling?`暂停路由 · ${reason??"上游异常"}`:recovering?"正在检测恢复":reason?`可再次尝试 · ${reason}`:"最近调用成功"}</p>{cooling&&health.cooldownUntil?<p className="text-muted">下次尝试 {time(health.cooldownUntil)}</p>:null}{health.lastSuccessAt?<p className="text-muted">最近成功 {time(health.lastSuccessAt)}</p>:null}{health.lastFailureAt?<p className="text-muted">最近失败 {time(health.lastFailureAt)}{health.lastFailureCategory?` · ${healthLabels[health.lastFailureCategory]??"上游异常"}`:""}</p>:null}</div>;
}
