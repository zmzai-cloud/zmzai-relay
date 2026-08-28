import { type NextRequest, NextResponse } from "next/server";

import { resolveApiKey } from "@/providers/auth/apikey";
import { getCurrentUser } from "@/providers/auth/session";
import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { getInternalModelSelectorData, getPublicModels } from "@/providers/catalog/public-models";

export const dynamic = "force-dynamic";

type Caller = { allowedModels: string[] | null };

async function resolveCaller(request: NextRequest): Promise<Caller | null> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const key = await resolveApiKey(authorization.slice(7).trim());
    return key ? { allowedModels: key.allowedModels.length ? key.allowedModels : null } : null;
  }

  return (await getCurrentUser()) ? { allowedModels: null } : null;
}

export async function GET(request: NextRequest) {
  const caller = await resolveCaller(request);
  if (!caller) {
    return NextResponse.json({ error: "需要有效的 API Token 或登录会话", code: "UNAUTHENTICATED" }, { status: 401 });
  }

  const now = new Date();
  const [models, modelSelectorData, healthyChannels] = await Promise.all([
    getPublicModels().then((all) =>
      all
        .filter((model) => model.routable)
        .filter((model) => !caller.allowedModels || caller.allowedModels.includes(model.model))
        .map(({ model, maxInputTokens, maxOutputTokens, allowedReasoningEfforts }) => ({ model, maxInputTokens, maxOutputTokens, allowedReasoningEfforts }))
    ),
    getInternalModelSelectorData(),
    ChannelModel.find({ enabled: true, $or: [{ cooldownUntil: null }, { cooldownUntil: { $lte: now } }] }).select("models").lean(),
  ]);
  // 每个模型当前可路由的健康渠道数：0 表示提交即会失败（所有渠道禁用/冷却），
  // 供调用方（如 Sandbox 控制台）在提交前提前拦截。
  const availableChannels = new Map<string, number>();
  for (const channel of healthyChannels) {
    for (const mapping of channel.models) availableChannels.set(mapping.public, (availableChannels.get(mapping.public) ?? 0) + 1);
  }
  const modelsWithHealth = models.map((model) => ({ ...model, availableChannels: availableChannels.get(model.model) ?? 0 }));

  return NextResponse.json({ models: modelsWithHealth, modelSelectorData });
}
