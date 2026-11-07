import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { ModelPriceModel } from "@/providers/database/mongodb/models/model-price";
import { cnyMicrosLabel } from "@/providers/billing/currency";
import { effectiveCachePrices, effectivePrice } from "@/providers/catalog/price-preview";
import { ModelHealthModel } from "@/providers/database/mongodb/models/model-health";
import { selectModelCandidates, type RoutingHealth } from "@/providers/channels/model-routing";

// 类型与 moneyMicros 定义在 client-safe 模块：client 组件（model-table 等）
// 必须从 public-model-types 引用，否则 Mongoose 代码会被打进客户端 bundle。
export { type PublicModel, type PublicChannelModel, type PublicChannel, moneyMicros } from "@/providers/catalog/public-model-types";

import { type PublicChannel, type PublicChannelModel, type PublicModel, moneyMicros } from "@/providers/catalog/public-model-types";

/** @deprecated Use `getPublicChannels()` instead — channel-first catalog. */
export async function getPublicModels(snapshot?: PublicChannel[]): Promise<PublicModel[]> {
  const [prices, channels] = await Promise.all([
    ModelPriceModel.find({ enabled: true, publicVisible: { $ne: false } }).sort({ model: 1 }).lean(),
    snapshot ? Promise.resolve(snapshot) : getPublicChannels(),
  ]);
  const routable = new Set(channels.flatMap((channel) => channel.models.filter((mapping) => mapping.available).map((mapping) => mapping.model)));
  return prices.map((price) => ({
    model: price.model,
    inputPricePer1kMicros: price.inputPricePer1kMicros,
    outputPricePer1kMicros: price.outputPricePer1kMicros,
    cacheReadPricePer1kMicros: price.cacheReadPricePer1kMicros,
    cacheWritePricePer1kMicros: price.cacheWritePricePer1kMicros,
    maxInputTokens: price.maxInputTokens,
    maxOutputTokens: price.maxOutputTokens,
    allowedReasoningEfforts: price.allowedReasoningEfforts,
    routable: routable.has(price.model),
  }));
}

/** 目录保留公开模型并显示当前路由状态；调用选择器单独过滤不可用项。 */
export async function getPublicChannels(): Promise<PublicChannel[]> {
  const now = new Date();
  const [prices, channels] = await Promise.all([
    ModelPriceModel.find({ enabled: true, publicVisible: { $ne: false } }).lean(),
    ChannelModel.find({ enabled: true }).select("+apiKey").sort({ priority: 1 }).lean(),
  ]);
  let health: RoutingHealth[] = [];
  if (channels.length) {
    try { health = await ModelHealthModel.find({channelId:{$in:channels.map(c=>c._id)}}).select("+fingerprint").lean(); }
    catch { console.error("读取模型健康状态失败，目录暂按可用展示"); }
  }
  const priceMap = new Map(prices.map((p) => [p.model, p]));
  return channels.map((channel) => ({
    channel: channel.name,
    priority: channel.priority,
    models: channel.models
      .filter((mapping) => priceMap.has(mapping.public))
      .map((mapping) => {
        const p = priceMap.get(mapping.public)!;
        const actual = effectivePrice(p, channel.executeMultiplier ?? 1);
        const cache = effectiveCachePrices(actual);
        return {
          model: mapping.public,
          available: selectModelCandidates([channel],health,mapping.public,now).available.length>0,
          inputPricePer1kMicros: actual.inputPricePer1kMicros,
          outputPricePer1kMicros: actual.outputPricePer1kMicros,
          cacheReadPricePer1kMicros: cache.cacheRead,
          cacheWritePricePer1kMicros: cache.cacheWrite,
          maxInputTokens: p.maxInputTokens,
          maxOutputTokens: p.maxOutputTokens,
          allowedReasoningEfforts: p.allowedReasoningEfforts,
          featured: p.featured,
          featuredDescription: p.featuredDescription,
        };
      }),
  })).filter((ch) => ch.models.length > 0);
}

/** ModelSelector 组件所需数据：推荐模型 + 渠道分组。 */
export interface PublicModelSelectorData {
  featured: { id: string; name: string; description: string; channel?: string }[];
  channels: { id: string; name: string; models: { id: string; name: string; channel?: string; meta?: Record<string, string> }[] }[];
}

/** 内部消费方（agent/sandbox）使用的扩展版，含 token 限制和推理强度。 */
export interface InternalModelSelectorData {
  featured: { id: string; name: string; description: string; channel?: string; maxInputTokens: number; maxOutputTokens: number; allowedReasoningEfforts: string[] }[];
  channels: { id: string; name: string; models: { id: string; name: string; channel?: string; meta?: Record<string, string>; maxInputTokens: number; maxOutputTokens: number; allowedReasoningEfforts: string[] }[] }[];
}

export async function getInternalModelSelectorData(snapshot?: PublicChannel[]): Promise<InternalModelSelectorData> {
  const channels = (snapshot ?? await getPublicChannels()).map(ch=>({...ch,models:ch.models.filter(m=>m.available)})).filter(ch=>ch.models.length>0);
  const seen = new Set<string>();
  const featured: InternalModelSelectorData["featured"] = [];
  for (const ch of channels) {
    for (const m of ch.models) {
      if (m.featured && !seen.has(m.model)) {
        seen.add(m.model);
        featured.push({
          id: m.model, name: m.model, description: m.featuredDescription, channel: ch.channel,
          maxInputTokens: m.maxInputTokens, maxOutputTokens: m.maxOutputTokens, allowedReasoningEfforts: m.allowedReasoningEfforts,
        });
      }
    }
  }
  return {
    featured,
    channels: channels.map((ch) => ({
      id: ch.channel,
      name: ch.channel,
      models: ch.models.map((m) => ({
        id: m.model,
        name: m.model,
        channel: ch.channel,
        meta: { input: `${moneyMicros(m.inputPricePer1kMicros)} / 1k`, output: `${moneyMicros(m.outputPricePer1kMicros)} / 1k` },
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
        allowedReasoningEfforts: m.allowedReasoningEfforts,
      })),
    })),
  };
}

export async function getPublicModelSelectorData(): Promise<PublicModelSelectorData> {
  const data = await getInternalModelSelectorData();
  return {
    featured: data.featured.map(({ id, name, description, channel }) => ({ id, name, description, channel })),
    channels: data.channels.map((ch) => ({
      id: ch.id, name: ch.name,
      models: ch.models.map(({ id, name, channel, meta }) => ({ id, name, channel, meta })),
    })),
  };
}
