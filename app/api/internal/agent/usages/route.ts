import { NextRequest, NextResponse } from "next/server";

import { isAgentServiceAuthorization } from "@/providers/auth/agent-service";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { UsageModel } from "@/providers/database/mongodb/models/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the settled, server-authoritative usage for one Agent Task Run.
 * This is intentionally internal-only: it contains no prompt, model key,
 * channel credential, or billing amount, just the token ledger needed by the
 * Agent project's budget reconciliation.
 */
export async function GET(request: NextRequest) {
  if (!isAgentServiceAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ code: "INTERNAL_SERVICE_UNAUTHORIZED", error: "未授权" }, { status: 401 });
  }
  const taskRunId = request.nextUrl.searchParams.get("taskRunId")?.trim();
  if (!taskRunId || taskRunId.length > 128) {
    return NextResponse.json({ code: "INVALID_QUERY", error: "taskRunId 必须提供" }, { status: 400 });
  }

  await connectMongo();
  const usages = await UsageModel.find({ callerKind: "agent_service", taskRunId, status: "completed" })
    .select({ _id: 1, promptTokens: 1, completionTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1, totalTokens: 1, updatedAt: 1 })
    .sort({ createdAt: 1 })
    .lean();
  const entries = usages.map((usage) => {
    const cacheReadTokens = Math.max(0, usage.cacheReadTokens ?? 0);
    const cacheWriteTokens = Math.max(0, usage.cacheWriteTokens ?? 0);
    const promptTokens = Math.max(0, usage.promptTokens ?? 0);
    const inputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
    return {
      usageId: String(usage._id),
      inputTokens,
      outputTokens: Math.max(0, usage.completionTokens ?? 0),
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: Math.max(0, usage.totalTokens ?? promptTokens + Math.max(0, usage.completionTokens ?? 0)),
      settledAt: usage.updatedAt,
    };
  });
  const totals = entries.reduce((result, entry) => ({
    inputTokens: result.inputTokens + entry.inputTokens,
    outputTokens: result.outputTokens + entry.outputTokens,
    cacheReadTokens: result.cacheReadTokens + entry.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens + entry.cacheWriteTokens,
    totalTokens: result.totalTokens + entry.totalTokens,
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 });
  return NextResponse.json({ taskRunId, usageCount: entries.length, usages: entries, totals }, { headers: { "cache-control": "no-store" } });
}
