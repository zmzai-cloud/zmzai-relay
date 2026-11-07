/** Safe, human-readable labels shared by the admin status and test panels. */
export const healthLabels:Record<string,string>={
 quota_exhausted:"额度已用尽",rate_limit:"请求过快",balance:"上游余额不足",auth:"上游鉴权失败",model_unavailable:"上游模型不可用",upstream:"上游异常",timeout:"上游超时",invalid_request:"请求参数错误",other:"响应异常",
};
