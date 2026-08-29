import { randomUUID } from "node:crypto";

import { UsageRecordedEventSchema, type UsageRecordedEvent, type UsageRecordedPayload } from "@zmzai/contracts";

import { getServerEnv } from "@/config/env";

/**
 * 遥测发送（fire-and-forget）：settle 成功后把 usage.recorded 推给 zmzai-billing。
 * 硬约束：绝不阻塞计费主流程 —— 150ms 超时、失败静默丢弃仅计数、不重试（v1 无持久化队列）。
 */

const EMIT_TIMEOUT_MS = 150;

const stats = { sent: 0, failed: 0 };
export function telemetryStats() {
  return { ...stats };
}

function countFailure(reason: string): void {
  stats.failed += 1;
  // 失败不打 console.error（避免刷屏/告警风暴）；需要排查时看这里
  if (process.env.NODE_ENV !== "production") console.debug(`[telemetry] emit failed: ${reason}`);
}

export function emitUsageRecorded(payload: UsageRecordedPayload & { traceId?: string; actorId?: string | null }): void {
  const env = getServerEnv();
  if (!env.BILLING_INGEST_URL || !env.BILLING_INGEST_KEY) return; // 未配置 → 静默跳过

  const event = {
    id: randomUUID(),
    ...(payload.traceId ? { traceId: payload.traceId } : {}),
    service: "relay" as const,
    type: "usage.recorded" as const,
    actorId: payload.actorId ?? null,
    payload: {
      userId: payload.userId,
      product: payload.product,
      metric: payload.metric,
      amount: payload.amount,
      ...(payload.costMicros !== undefined ? { costMicros: payload.costMicros } : {}),
      ...(payload.meta ? { meta: payload.meta } : {}),
    },
    at: new Date().toISOString(),
  };
  const parsed = UsageRecordedEventSchema.safeParse(event);
  if (!parsed.success) {
    countFailure("schema");
    return;
  }
  void ingest(parsed.data as UsageRecordedEvent, env.BILLING_INGEST_URL, env.BILLING_INGEST_KEY);
}

async function ingest(event: UsageRecordedEvent, url: string, key: string): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ events: [event] }),
      signal: AbortSignal.timeout(EMIT_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) countFailure(`http_${res.status}`);
    else stats.sent += 1;
  } catch {
    countFailure("network_or_timeout");
  }
}
