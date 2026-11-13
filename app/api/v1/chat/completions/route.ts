import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isSandboxServiceAuthorization, resolveSandboxKey } from "@/providers/auth/sandbox-key";
import { isAgentServiceAuthorization } from "@/providers/auth/agent-service";
import { resolveApiKey } from "@/providers/auth/apikey";
import { getCurrentUser } from "@/providers/auth/session";
import { UserModel } from "@zmzai/db";
import { chargeMicros, maximumChargeMicros, reserveBalance, releaseReservation, settleReservation, BillingError } from "@/providers/billing/service";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ChannelAttemptModel } from "@/providers/database/mongodb/models/channel-attempt";
import { ChannelModel, resolveChannelCosts, type ModelCostOverride } from "@/providers/database/mongodb/models/channel";
import { claimModelRecovery, releaseModelRecovery, recordModelSuccess, recordModelFailure, startRecoveryHeartbeat, type RecoveryLease, type ModelHealthKey } from "@/providers/channels/model-health";
import { selectModelCandidates, type RoutingHealth } from "@/providers/channels/model-routing";
import { classifyUpstreamError, readUpstreamErrorBody, type UpstreamErrorCategory } from "@/providers/channels/upstream-errors";
import { ModelHealthModel } from "@/providers/database/mongodb/models/model-health";
import { probeFingerprint } from "@/providers/catalog/model-probe";
import { ModelPriceModel, reasoningEfforts } from "@/providers/database/mongodb/models/model-price";
import { RateLimitBucketModel } from "@/providers/database/mongodb/models/rate-limit";
import { UsageModel } from "@/providers/database/mongodb/models/usage";
import { safeUpstreamFetch } from "@/providers/network/safe-upstream-fetch";
import { effectiveCachePrices, effectivePrice } from "@/providers/catalog/price-preview";

export const dynamic = "force-dynamic";

const chatMessageSchema = z.object({
  role: z.string(),
  // OpenAI wire format 允许 content 为字符串或多模态块数组；块只需 type，
  // 其余字段（text/image_url 等）随 passthrough 透传——多模态块（image）
  // 没有 text 字段，若强制要求会被误拒为 400 INVALID_BODY。
  content: z.string().nullable().or(
    z.array(z.object({ type: z.string() }).passthrough()).min(1),
  ),
}).passthrough();

const chatSchema = z.object({
  channel: z.string().min(1).optional(),
  model: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  reasoning_effort: z.enum(reasoningEfforts).optional(),
  requestId: z.string().max(128).optional(),
}).strict().passthrough();

type Caller = { kind: "apikey" | "session" | "sandbox_key" | "agent_service"; id: string; userId: string; label: string; allowedModels: string[] | null; rpm: number | null; taskRunId: string | null };
function error(code: string, status: number, message: string) { return NextResponse.json({ error: message, code }, { status }); }
function upstreamUnavailable(categories: (UpstreamErrorCategory | null)[], retryAt?: Date | null) {
  const category = categories.length && categories.every((item) => item === categories[0]) ? categories[0] : null;
  const descriptions: Partial<Record<UpstreamErrorCategory, [string, string]>> = {
    quota_exhausted: ["UPSTREAM_QUOTA_EXHAUSTED", "上游额度已用尽，请等待恢复或联系管理员"],
    rate_limit: ["UPSTREAM_RATE_LIMITED", "上游请求过于频繁，请稍后重试"],
    balance: ["UPSTREAM_BALANCE", "上游账户余额不足，请联系管理员"],
    auth: ["UPSTREAM_AUTH", "上游鉴权失败，请联系管理员"],
    model_unavailable: ["UPSTREAM_MODEL_UNAVAILABLE", "上游模型不可用，请联系管理员"],
    upstream: ["UPSTREAM_UNAVAILABLE", "上游服务暂不可用，请稍后重试"],
    timeout: ["UPSTREAM_UNAVAILABLE", "上游请求超时，请稍后重试"],
    invalid_request: ["UPSTREAM_INVALID_REQUEST", "上游不接受请求参数，请检查模型及参数"],
  };
  const [code, message] = (category && descriptions[category]) || ["UPSTREAM_ERROR", "所有上游渠道均不可用"];
  const headers = retryAt ? { "Retry-After": String(Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000))) } : undefined;
  return NextResponse.json({ error: message, code }, { status: category === "invalid_request" ? 400 : category ? 503 : 502, headers });
}

/** 从上游 usage 中提取 cache token 数（兼容 Anthropic 顶层字段、OpenAI 嵌套格式
 *  与 DeepSeek 原生 prompt_cache_hit_tokens）。 */
function extractCacheTokens(tokens: Record<string, unknown>): { cacheRead: number; cacheWrite: number } {
  let cacheRead = 0;
  let cacheWrite = 0;
  if (typeof tokens.cache_read_input_tokens === "number") cacheRead = tokens.cache_read_input_tokens;
  if (typeof tokens.cache_creation_input_tokens === "number") cacheWrite = tokens.cache_creation_input_tokens;
  const details = tokens.prompt_tokens_details as Record<string, unknown> | undefined;
  if (typeof details?.cached_tokens === "number") cacheRead = details.cached_tokens;
  if (typeof tokens.prompt_cache_hit_tokens === "number") cacheRead = tokens.prompt_cache_hit_tokens;
  return { cacheRead, cacheWrite };
}

async function logRejectedRequest(caller: Caller, model: string, message: string, requestId?: string) {
  const id = requestId ?? randomUUID();
  await UsageModel.updateOne(
    { callerKind: caller.kind, callerId: caller.id, requestId: id },
    { $setOnInsert: { requestId: id, userId: caller.userId, apiKeyId: caller.kind === "apikey" ? caller.id : null, sandboxKeyId: caller.kind === "sandbox_key" ? caller.id : null, callerKind: caller.kind, callerId: caller.id, taskRunId: caller.taskRunId, channelId: null, model: model || "unknown", upstreamModel: "not-routed", status: "failed", lastError: message } },
    { upsert: true },
  );
}

async function callerFor(req: NextRequest): Promise<Caller | null> {
  const agentUserId = req.headers.get("x-zmzai-agent-user-id");
  if (agentUserId && isAgentServiceAuthorization(req.headers.get("authorization"))) {
    await connectMongo();
    const user = await UserModel.findById(agentUserId).lean();
    if (!user || user.status !== "active" || (!user.emailVerified && user.role !== "admin")) return null;
    return { kind: "agent_service", id: `agent:${user._id}`, userId: String(user._id), label: "a.zmzai.cloud", allowedModels: null, rpm: 60, taskRunId: req.headers.get("x-zmzai-agent-task-run-id")?.slice(0, 128) ?? null };
  }
  const sandboxKey = req.headers.get("x-zmzai-sandbox-key");
  if (sandboxKey && isSandboxServiceAuthorization(req.headers.get("authorization"))) {
    const key = await resolveSandboxKey(sandboxKey);
    return key ? { kind: "sandbox_key", id: key.id, userId: key.userId, label: key.name, allowedModels: null, rpm: 60, taskRunId: null } : null;
  }
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const key = await resolveApiKey(auth.slice(7).trim());
    return key ? { kind: "apikey", id: key.id, userId: key.userId, label: key.name, allowedModels: key.allowedModels.length ? key.allowedModels : null, rpm: key.rateLimitPerMinute, taskRunId: null } : null;
  }
  const user = await getCurrentUser();
  return user ? { kind: "session", id: user.id, userId: user.id, label: user.name, allowedModels: null, rpm: null, taskRunId: null } : null;
}

async function consumeRateLimit(keyId: string, limit: number): Promise<boolean> {
  const now = new Date();
  now.setSeconds(0, 0);
  const bucket = await RateLimitBucketModel.findOneAndUpdate(
    { keyId, windowStart: now }, { $inc: { count: 1 }, $setOnInsert: { keyId, windowStart: now } }, { upsert: true, new: true },
  );
  return bucket.count <= limit;
}

export async function POST(req: NextRequest) {
  const traceId = req.headers.get("x-trace-id"); // 透传 agent 侧生成的追踪 ID（遥测用，可空）
  const caller = await callerFor(req);
  if (!caller) return error("UNAUTHENTICATED", 401, "需要有效的 API Token 或登录会话");
  const body = await req.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  // 400 带首个校验错误明细（字段路径 + 原因），避免调用方只能看到笼统的
  // 「请求体格式不正确」而无法定位（如 reasoning_effort 档位不在枚举内）。
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return error("INVALID_BODY", 400, `请求体格式不正确：${issue ? issue.path.join(".") + " " + issue.message : "未知字段"}`);
  }
  const requestedMaxTokens = parsed.data.max_tokens ?? parsed.data.max_output_tokens ?? parsed.data.max_completion_tokens;
  if (requestedMaxTokens && !parsed.data.max_tokens) parsed.data.max_tokens = requestedMaxTokens;
  if (caller.allowedModels && !caller.allowedModels.includes(parsed.data.model)) return error("MODEL_NOT_ALLOWED", 403, "此 Token 不允许调用该模型");
  if ((caller.kind === "apikey" || caller.kind === "sandbox_key" || caller.kind === "agent_service") && !(await consumeRateLimit(caller.id, caller.rpm ?? 60))) return error("RATE_LIMITED", 429, "此调用方已达到每分钟调用上限");

  await connectMongo();
  // 模型目录以 ModelPrice 集合为准（管理员可在「模型与价格」页面维护），不再依赖代码硬编码列表
  const price = await ModelPriceModel.findOne({ model: parsed.data.model }).lean();
  if (!price) {
    await logRejectedRequest(caller, parsed.data.model, "该模型不在当前开放目录", parsed.data.requestId);
    return error("MODEL_NOT_FOUND", 400, "该模型不在当前开放目录");
  }
  if (!price.enabled) return error("MODEL_NOT_PRICED", 400, "该模型尚未开放或未配置价格");
  if (parsed.data.reasoning_effort && !price.allowedReasoningEfforts.includes(parsed.data.reasoning_effort)) return error("REASONING_EFFORT_NOT_ALLOWED", 400, "该模型不支持此推理强度");
  // 客户端可能发送超过模型上限的 max_tokens（如 Codex/zcode 默认值），自动截断到模型上限而非报错
  if ((parsed.data.max_tokens ?? 4096) > price.maxOutputTokens) {
    parsed.data.max_tokens = price.maxOutputTokens;
  }
  // 编程 agent（zcode/Codex）上下文可达 MB 级（多轮对话 + 代码文件），128 KiB 会挡掉正常使用；
  // 提到 8 MiB 与模型 1M 输入上下文匹配，同时保留防滥用底线。
  const messagesJson = JSON.stringify(parsed.data.messages);
  if (Buffer.byteLength(messagesJson, "utf8") > 8 * 1024 * 1024) return error("PROMPT_TOO_LARGE", 400, "消息内容超过 8 MiB 限制");

  const requestId = parsed.data.requestId ?? randomUUID();
  const existing = await UsageModel.findOne({ callerKind: caller.kind, callerId: caller.id, requestId }).lean();
  if (existing) return error(existing.status === "processing" ? "REQUEST_IN_PROGRESS" : "REQUEST_ALREADY_PROCESSED", 409, "此 requestId 已处理，不能重复调用");

  const usage = await UsageModel.create({ requestId, userId: caller.userId, apiKeyId: caller.kind === "apikey" ? caller.id : null, sandboxKeyId: caller.kind === "sandbox_key" ? caller.id : null, callerKind: caller.kind, callerId: caller.id, taskRunId: caller.taskRunId, channelId: null, model: parsed.data.model, upstreamModel: "pending", status: "processing" });

  // 确定候选渠道：指定 channel 则直连，否则按 priority 自动路由（提前到预留前，预留需按渠道执行倍率）
  const specifiedChannelName = parsed.data.channel;
  let candidates;
  if (specifiedChannelName) {
    const ch = await ChannelModel.findOne({ name: specifiedChannelName, enabled: true, "models.public": parsed.data.model }).select("+apiKey").lean();
    candidates = ch ? [ch] : [];
  } else {
    candidates = await ChannelModel.find({ enabled: true, "models.public": parsed.data.model }).select("+apiKey").sort({ priority: 1 }).lean();
  }
  if (!candidates.length) {
    await UsageModel.updateOne({ _id: usage._id }, { $set: { status: "failed", lastError: specifiedChannelName ? `channel "${specifiedChannelName}" not found or missing model` : "no eligible channel" } });
    return error(specifiedChannelName ? "CHANNEL_NOT_FOUND" : "NO_CHANNEL", specifiedChannelName ? 404 : 503, specifiedChannelName ? `渠道 "${specifiedChannelName}" 不可用或未配置该模型` : "没有可用上游渠道");
  }
  // 健康状态按渠道和模型隔离；渠道配置变化后旧状态自动失效。
  let health: RoutingHealth[] = [];
  try { health = await ModelHealthModel.find({channelId:{$in:candidates.map(c=>c._id)},publicModel:parsed.data.model}).select("+fingerprint").lean(); }
  catch { console.error("读取模型健康状态失败，按原路由继续"); }
  const selected = selectModelCandidates(candidates, health, parsed.data.model);
  candidates = selected.available;
  if (!candidates.length) {
    await UsageModel.updateOne({ _id: usage._id }, { $set: { status: "failed", lastError: "all model routes cooling down" } });
    const next = selected.blocked.map(h=>new Date(Math.max(h.cooldownUntil?.getTime()??0,h.leaseUntil?.getTime()??0))).sort((a,b)=>a.getTime()-b.getTime())[0];
    return upstreamUnavailable(selected.blocked.map(h=>h.category),next);
  }

  // 预留贴近实际可能消耗：输入按请求体估算 tokens（字节/3，cap 模型上限），
  // 输出按请求 max_tokens（已 clamp，未传按 4096）。不再按模型 maxInput/maxOutput 全额预留——
  // 那会要求余额覆盖理论最大费用（如 terra ≈ ¥1.4 万），正常用户全部 402。
  const reservePrice = effectivePrice(price, Math.max(...candidates.map((channel) => channel.executeMultiplier ?? 1)));
  const estimatedInputTokens = Math.min(price.maxInputTokens, Math.max(1, Math.ceil(Buffer.byteLength(messagesJson, "utf8") / 3)));
  const reserveOutputTokens = Math.min(parsed.data.max_tokens ?? 4096, price.maxOutputTokens);
  const reserved = maximumChargeMicros({ maxInputTokens: estimatedInputTokens, maxOutputTokens: reserveOutputTokens, ...reservePrice, cacheWritePricePer1kMicros: reservePrice.cacheWritePricePer1kMicros || undefined });
  try { await reserveBalance({ usageId: usage._id, userId: caller.userId, apiKeyId: caller.kind === "apikey" ? caller.id : null, amountMicros: reserved }); }
  catch (e) {
    await UsageModel.deleteOne({ _id: usage._id });
    if (e instanceof BillingError) return error(e.code, 402, e.message);
    throw e;
  }

  const failures: UpstreamErrorCategory[] = [];
  const retries: Date[] = [];
  for (const channel of candidates) {
    const upstreamModel = channel.models.find((item) => item.public === parsed.data.model)?.upstream ?? parsed.data.model;
    const healthKey: ModelHealthKey = {startedAt:new Date(),channelId:channel._id,publicModel:parsed.data.model,fingerprint:probeFingerprint({baseUrl:channel.baseUrl,apiKey:channel.apiKey,publicModel:parsed.data.model,upstreamModel})};
    const previous=health.find(h=>String(h.channelId)===String(channel._id)&&h.publicModel===parsed.data.model&&h.fingerprint===healthKey.fingerprint);
    let recoveryLease: RecoveryLease | null = null;
    const leaseMs=(channel.timeoutMs??60000)+135000;
    if(previous?.cooldownUntil && previous.cooldownUntil.getTime()<=Date.now() && previous.category){
      recoveryLease=await claimModelRecovery(healthKey,new Date(),leaseMs).catch(()=>null);
      if(!recoveryLease){failures.push(previous.category);retries.push(new Date(Date.now()+5000));continue;}
      healthKey.leaseToken=recoveryLease.token;
    }
    const heartbeat=recoveryLease ? startRecoveryHeartbeat(healthKey,recoveryLease,leaseMs) : null;
    let streamOwnsHeartbeat=false;
    const started = Date.now();
    // 实际收费价 = 模型标准价 × 渠道执行倍率（乘渠道折扣后计费并写入快照）
    const effective = effectivePrice(price, channel.executeMultiplier ?? 1);
    let received = false;
    try {
      // 思考参数翻译（2026-11-12 推理档位事故）：GLM 系上游只认 thinking:{type}，
      // OpenAI 的 reasoning_effort 透传会被静默忽略——客户端档位形同虚设
      // （用户实测 minimal 档 hello 仍思考 12s）。渠道声明 thinkingFormat:"zai"
      // 时翻译；off/minimal→disabled（GLM 无档位，极低=别想），low+→enabled。
      let upstreamBody: Record<string, unknown> = { ...parsed.data, model: upstreamModel, requestId: undefined, stream_options: parsed.data.stream ? { include_usage: true } : undefined };
      if ((channel as { thinkingFormat?: string | null }).thinkingFormat === "zai") {
        const effort = parsed.data.reasoning_effort;
        if (effort !== undefined) {
          const { reasoning_effort: _dropped, ...rest } = upstreamBody as Record<string, unknown> & { reasoning_effort?: string };
          // GLM 无思考档位：minimal（UI 极低档）= disabled，其余一律 enabled
          upstreamBody = { ...rest, thinking: { type: effort === "minimal" ? "disabled" : "enabled", clear_thinking: false } };
        }
      }
      // 建连/首字节超时（channel.timeoutMs）：response header 到达即摘除，
      // 不覆盖流式读取——AbortSignal.timeout 曾把活跃长输出（PPT 几百行
      // 脚本）在 60/120s 硬切报 terminated/aborted。流式卡死保护由
      // streamResponse 的 idle watchdog（120s 无新数据才中断）负责。
      const upstream = await safeUpstreamFetch(`${channel.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${channel.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(upstreamBody), connectTimeoutMs: channel.timeoutMs, signal: heartbeat?.signal });
      if (!upstream.ok) {
        const classified = classifyUpstreamError(upstream.status, await readUpstreamErrorBody(upstream), upstream.headers.get("retry-after"));
        failures.push(classified.category); if(classified.retryAt) retries.push(classified.retryAt);
        await ChannelAttemptModel.create({ usageId: usage._id, channelId: channel._id, upstreamModel, status: "failed", latencyMs: Date.now() - started, error: `HTTP ${upstream.status}: ${classified.category}`, costStatus: "not_charged" });
        if(classified.affectsHealth) await recordModelFailure(healthKey, classified).catch(()=>console.error("记录模型健康状态失败"));
        else if(recoveryLease) await releaseModelRecovery(healthKey,recoveryLease).catch(()=>console.error("释放模型检测锁失败"));
        continue;
      }
      if (parsed.data.stream && upstream.body) { streamOwnsHeartbeat=true; return streamResponse(upstream.body, usage._id, channel, upstreamModel, parsed.data.model, effective, started, traceId, healthKey, recoveryLease,heartbeat); }
      const json = await upstream.json().catch(() => null);
      const tokens = json?.usage as Record<string, unknown> | undefined;
      if (!tokens) { if(recoveryLease) await releaseModelRecovery(healthKey,recoveryLease).catch(()=>console.error("释放模型检测锁失败")); await releaseReservation(usage._id); await UsageModel.updateOne({ _id: usage._id }, { $set: { status: "unsettled", lastError: "upstream omitted usage" } }); return error("USAGE_UNAVAILABLE", 502, "上游未返回用量，已取消扣费"); }
      const prompt = (tokens.prompt_tokens as number) ?? 0; const completion = (tokens.completion_tokens as number) ?? 0;
      const { cacheRead, cacheWrite } = extractCacheTokens(tokens);
      const regularInput = Math.max(0, prompt - cacheRead - cacheWrite);
      const cachePrices = effectiveCachePrices(effective);
      const charged = chargeMicros(regularInput, effective.inputPricePer1kMicros) + chargeMicros(cacheRead, cachePrices.cacheRead) + chargeMicros(cacheWrite, cachePrices.cacheWrite) + chargeMicros(completion, effective.outputPricePer1kMicros);
      const channelCosts = resolveChannelCosts(channel, parsed.data.model);
      const cost = channelCosts ? chargeMicros(regularInput, channelCosts.inputCostPer1kTokensMicros) + chargeMicros(cacheRead, channelCosts.cacheReadCostPer1kTokensMicros) + chargeMicros(cacheWrite, channelCosts.cacheWriteCostPer1kTokensMicros) + chargeMicros(completion, channelCosts.outputCostPer1kTokensMicros) : 0;
      received = true;
      await ChannelAttemptModel.create({ usageId: usage._id, channelId: channel._id, upstreamModel, status: "completed", latencyMs: Date.now() - started, error: null, costStatus: channelCosts ? "known" : "unknown" });
      await settleReservation(usage._id, { chargedMicros: charged, costMicros: cost, promptTokens: prompt, completionTokens: completion, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, channelId: channel._id, upstreamModel, latencyMs: Date.now() - started, inputPricePer1kMicros: effective.inputPricePer1kMicros, outputPricePer1kMicros: effective.outputPricePer1kMicros, cacheReadPricePer1kMicros: cachePrices.cacheRead, cacheWritePricePer1kMicros: cachePrices.cacheWrite, inputCostPer1kTokensMicros: channelCosts?.inputCostPer1kTokensMicros ?? 0, outputCostPer1kTokensMicros: channelCosts?.outputCostPer1kTokensMicros ?? 0, cacheReadCostPer1kTokensMicros: channelCosts?.cacheReadCostPer1kTokensMicros ?? 0, cacheWriteCostPer1kTokensMicros: channelCosts?.cacheWriteCostPer1kTokensMicros ?? 0 }, { traceId });
      await recordModelSuccess(healthKey).catch(()=>console.error("记录模型健康状态失败"));
      if (specifiedChannelName) return NextResponse.json(json);
      return NextResponse.json(json);
    } catch (e) { if(received) throw e; failures.push("upstream"); await ChannelAttemptModel.create({ usageId: usage._id, channelId: channel._id, upstreamModel, status: "failed", latencyMs: Date.now() - started, error: "upstream network failure", costStatus: "unknown" }); await recordModelFailure(healthKey,{category:"upstream",affectsHealth:true,retryAt:null}).catch(()=>console.error("记录模型健康状态失败")); } finally {if(!streamOwnsHeartbeat)heartbeat?.stop();}
  }
  await releaseReservation(usage._id); await UsageModel.updateOne({ _id: usage._id }, { $set: { status: "failed", lastError: "all eligible channels failed" } });
  return upstreamUnavailable(failures,retries.sort((a,b)=>a.getTime()-b.getTime())[0]);
}

/** 流式 idle 超时：只要在此时长内收到过新数据就重置计时；连续无新数据
 *  才判定为死连接。活跃的长输出（如几百行脚本）不会被误杀。 */
const UPSTREAM_STREAM_IDLE_TIMEOUT_MS = 120_000;

function streamResponse(body: ReadableStream<Uint8Array>, usageId: import("mongoose").Types.ObjectId, channel: { _id: import("mongoose").Types.ObjectId; inputCostPer1kTokensMicros: number | null; outputCostPer1kTokensMicros: number | null; cacheReadCostPer1kTokensMicros: number | null; cacheWriteCostPer1kTokensMicros: number | null; modelCosts: Record<string, ModelCostOverride> }, upstreamModel: string, publicModel: string, price: { inputPricePer1kMicros: number; outputPricePer1kMicros: number; cacheReadPricePer1kMicros: number; cacheWritePricePer1kMicros: number }, started: number, traceId: string | null | undefined, healthKey: ModelHealthKey, recoveryLease: RecoveryLease | null, heartbeat: ReturnType<typeof startRecoveryHeartbeat> | null) {
  const stream = new ReadableStream<Uint8Array>({ async start(controller) {
    const reader = body.getReader(); const decoder = new TextDecoder(); let raw = ""; let upstreamComplete = false;
    try { for (;;) {
      // idle watchdog：每次 read 最多等 IDLE_TIMEOUT，有新数据即重置。
      // 用 setTimeout + reject，read 成功后 clearTimeout 干净清理。
      let timer: NodeJS.Timeout | undefined;
      const idleTimeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("UPSTREAM_STREAM_IDLE_TIMEOUT")), UPSTREAM_STREAM_IDLE_TIMEOUT_MS); });
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await Promise.race([reader.read(), idleTimeout]); }
      finally { if (timer) clearTimeout(timer); }
      if (next.done) break; raw += decoder.decode(next.value, { stream: true }); controller.enqueue(next.value);
    }
      raw += decoder.decode();
      upstreamComplete = true;
      let value: Record<string, unknown> | null = null;
      for (const line of raw.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try { const event = JSON.parse(payload); if (event.usage) value = event.usage; } catch { /* Ignore malformed non-usage events already sent to the client. */ }
      }
      if (!value) { if(recoveryLease) await releaseModelRecovery(healthKey,recoveryLease).catch(()=>console.error("释放模型检测锁失败")); await releaseReservation(usageId); await UsageModel.updateOne({ _id: usageId }, { $set: { status: "unsettled", lastError: "stream omitted usage" } }); }
      else {
        const prompt = (value.prompt_tokens as number) ?? 0; const completion = (value.completion_tokens as number) ?? 0;
        const { cacheRead, cacheWrite } = extractCacheTokens(value);
        const regularInput = Math.max(0, prompt - cacheRead - cacheWrite);
        const cachePrices = effectiveCachePrices(price);
        const charged = chargeMicros(regularInput, price.inputPricePer1kMicros) + chargeMicros(cacheRead, cachePrices.cacheRead) + chargeMicros(cacheWrite, cachePrices.cacheWrite) + chargeMicros(completion, price.outputPricePer1kMicros);
        const channelCosts = resolveChannelCosts(channel, publicModel);
        const inputCost = channelCosts?.inputCostPer1kTokensMicros ?? 0; const outputCost = channelCosts?.outputCostPer1kTokensMicros ?? 0;
        const cacheReadCost = channelCosts?.cacheReadCostPer1kTokensMicros ?? 0; const cacheWriteCost = channelCosts?.cacheWriteCostPer1kTokensMicros ?? 0;
        const cost = channelCosts ? chargeMicros(regularInput, inputCost) + chargeMicros(cacheRead, cacheReadCost) + chargeMicros(cacheWrite, cacheWriteCost) + chargeMicros(completion, outputCost) : 0;
        await ChannelAttemptModel.create({ usageId, channelId: channel._id, upstreamModel, status: "completed", latencyMs: Date.now() - started, error: null, costStatus: channelCosts ? "known" : "unknown" });
        await settleReservation(usageId, { chargedMicros: charged, costMicros: cost, promptTokens: prompt, completionTokens: completion, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, channelId: channel._id, upstreamModel, latencyMs: Date.now() - started, inputPricePer1kMicros: price.inputPricePer1kMicros, outputPricePer1kMicros: price.outputPricePer1kMicros, cacheReadPricePer1kMicros: cachePrices.cacheRead, cacheWritePricePer1kMicros: cachePrices.cacheWrite, inputCostPer1kTokensMicros: inputCost, outputCostPer1kTokensMicros: outputCost, cacheReadCostPer1kTokensMicros: cacheReadCost, cacheWriteCostPer1kTokensMicros: cacheWriteCost }, { traceId });
        await recordModelSuccess(healthKey).catch(()=>console.error("记录模型健康状态失败"));
      }
      controller.close();
    } catch (e) { await releaseReservation(usageId); const isIdle = e instanceof Error && e.message.includes("IDLE_TIMEOUT"); const detail = e instanceof Error ? `${e.message}${e.cause ? `; cause=${(e.cause as Error).message ?? String(e.cause)}` : ""}` : String(e); const reason = isIdle ? "上游流 120s 无数据（idle 超时），疑似死连接" : `上游流读取失败: ${detail.slice(0, 150)}`; console.error("[stream-fail]", usageId.toString(), detail); await UsageModel.updateOne({ _id: usageId }, { $set: { status: "failed", lastError: reason.slice(0, 200) } }); if(!upstreamComplete) await recordModelFailure(healthKey,{category:"upstream",affectsHealth:true,retryAt:null}).catch(()=>console.error("记录模型健康状态失败")); else if(recoveryLease) await releaseModelRecovery(healthKey,recoveryLease).catch(()=>console.error("释放模型检测锁失败")); controller.error(new Error(reason)); } finally {heartbeat?.stop();}
  }});
  return new NextResponse(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
