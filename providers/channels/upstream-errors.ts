export type UpstreamErrorCategory = "quota_exhausted" | "rate_limit" | "balance" | "auth" | "model_unavailable" | "upstream" | "timeout" | "invalid_request" | "other";
export type UpstreamError = {category:UpstreamErrorCategory;affectsHealth:boolean;retryAt:Date|null};
const SECOND=1000, HOUR=60*60*SECOND, DAY=24*HOUR;
function retryDelay(header:string|null,now:Date):number|null {
  if (!header) return null;
  const seconds=Number(header.trim());
  const delay=Number.isFinite(seconds)&&header.trim()!==""?seconds*SECOND:Date.parse(header)-now.getTime();
  return Number.isFinite(delay)&&delay>0?Math.min(DAY,Math.max(SECOND,delay)):null;
}
export function classifyUpstreamError(status:number,body:string,retryAfter:string|null,now=new Date()):UpstreamError {
  let category:UpstreamErrorCategory,code="",message="",type="";
  try {const parsed=JSON.parse(body);code=String(parsed?.error?.code??parsed?.code??"");type=String(parsed?.error?.type??parsed?.type??"");message=String(parsed?.error?.message??parsed?.message??"").slice(0,2000);} catch {message=body.slice(0,2000)}
  if(status===429) {
    const quota=code==="1310"||/insufficient_quota|quota_exceeded|billing_hard_limit/i.test(code)||/quota.{0,30}(exceed|exhaust|limit)|(?:weekly|monthly).{0,40}(quota|limit)|(?:周|月).{0,12}(额度|限额|使用上限)|(?:余额|配额).{0,12}(不足|耗尽|用尽)/i.test(message);
    category=quota?"quota_exhausted":"rate_limit";
  } else if((status===400||status===403)&&(/content[_-]?filter|content[_-]?policy|safety[_-]?(violation|filter)/i.test(`${code} ${type}`)||/content.{0,24}(policy|moderation|filter)|safety.{0,24}(violation|filter)|内容.{0,20}(安全|审核|违规|政策)/i.test(message))) category="invalid_request";
  else if((status===400||status===404)&&(/model[_-]?(not[_-]?found|unavailable|unsupported)/i.test(code)||/model.{0,60}(not found|does not exist|unsupported)|模型.{0,12}(不存在|不支持|未找到)/i.test(message))) category="model_unavailable";
  else if(status===402) category="balance";
  else if(status===401||status===403) category="auth";
  else if(status>=500) category="upstream";
  else if(status>=400&&status<500) category="invalid_request";
  else category="other";
  const retry=retryDelay(retryAfter,now);
  const delay=category==="quota_exhausted"?Math.max(HOUR,retry??0):category==="rate_limit"?(retry??30*SECOND):category==="balance"||category==="auth"||category==="model_unavailable"?30*60*SECOND:null;
  return {category,affectsHealth:category!=="invalid_request",retryAt:delay===null?null:new Date(now.getTime()+delay)};
}

/** Read only a small error prefix; callers must not expose or log the raw text. */
export async function readUpstreamErrorBody(response:Response,limit=8192):Promise<string> {
  if(!response.body)return "";
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {while(size<limit){const {done,value}=await reader.read();if(done)break;const part=value.subarray(0,limit-size);chunks.push(part);size+=part.length;if(part.length<value.length)break;}}
  catch {return ""} finally {await reader.cancel().catch(()=>{});reader.releaseLock()}
  return new TextDecoder().decode(Buffer.concat(chunks));
}
