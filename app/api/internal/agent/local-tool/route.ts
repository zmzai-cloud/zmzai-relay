import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAgentServiceAuthorization } from "@/providers/auth/agent-service";
import { getBridgeClient } from "@/providers/bridge/client";
import { BridgeError } from "@/providers/bridge/bridge-sdk";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { UserModel } from "@zmzai/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toolSchema = z.enum(["fs.read", "fs.write", "shell.exec", "notify"]);
const riskSchema = z.enum(["low", "medium", "high"]);

const bodySchema = z
  .object({
    tool: toolSchema,
    params: z.unknown(),
    requestId: z.string().max(128).optional(),
    risk: riskSchema.optional(),
  })
  .strict();

/**
 * 内部端点：Agent → Relay → zmzai-bridge → 用户本机（zmzai-client）。
 *
 * 仅允许 a.zmzai.cloud 的 Agent 服务端调用（agent-service 密钥）；
 * userId 取自 `x-zmzai-agent-user-id` 头（与 /internal/agent/chat 同源），
 * 并校验用户存在且激活 —— 防 Agent 把请求发往非授权用户的本机。
 *
 * POST：下发工具请求（fs.read / fs.write / shell.exec / notify），
 *       阻塞等待客户端本地执行（含审批）后回传结果。
 * GET ：探测用户当前是否绑定了在线的桌面客户端（Agent 据此决定是否暴露本机工具）。
 */
async function callerUserId(req: NextRequest): Promise<string | null> {
  const authorization = req.headers.get("authorization");
  if (!isAgentServiceAuthorization(authorization)) return null;
  const userId = req.headers.get("x-zmzai-agent-user-id");
  return userId && userId.length > 0 && userId.length <= 128 ? userId : null;
}

async function userIsActive(userId: string): Promise<boolean> {
  await connectMongo();
  const user = await UserModel.findById(userId).lean();
  return Boolean(user && user.status === "active" && (user.emailVerified || user.role === "admin"));
}

function mapBridgeError(e: unknown): NextResponse {
  if (e instanceof BridgeError) {
    if (e.status === 409) {
      return NextResponse.json({ code: "CLIENT_OFFLINE", error: e.message }, { status: 409 });
    }
    if (e.status === 504) {
      return NextResponse.json({ code: "DISPATCH_TIMEOUT", error: e.message }, { status: 504 });
    }
    return NextResponse.json({ code: "BRIDGE_ERROR", error: e.message }, { status: 502 });
  }
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ code: "INTERNAL_ERROR", error: message }, { status: 502 });
}

export async function POST(req: NextRequest) {
  const userId = await callerUserId(req);
  if (!userId) return NextResponse.json({ code: "INTERNAL_SERVICE_UNAUTHORIZED", error: "未授权" }, { status: 401 });
  if (!(await userIsActive(userId))) return NextResponse.json({ code: "USER_FORBIDDEN", error: "用户不存在或未激活" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_BODY", error: "请求体格式不正确" }, { status: 400 });

  try {
    const result = await getBridgeClient().dispatchToUser(userId, parsed.data.tool, parsed.data.params, {
      id: parsed.data.requestId,
      risk: parsed.data.risk,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mapBridgeError(e);
  }
}

export async function GET(req: NextRequest) {
  const userId = await callerUserId(req);
  if (!userId) return NextResponse.json({ code: "INTERNAL_SERVICE_UNAUTHORIZED", error: "未授权" }, { status: 401 });
  if (!(await userIsActive(userId))) return NextResponse.json({ code: "USER_FORBIDDEN", error: "用户不存在或未激活" }, { status: 403 });

  try {
    const bound = await getBridgeClient().getUserClient(userId);
    if (!bound) return NextResponse.json({ bound: false, userId }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ bound: true, userId, ...bound }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mapBridgeError(e);
  }
}
