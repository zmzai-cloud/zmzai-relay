import { ChannelModel } from "@/providers/database/mongodb/models/channel";
import { ModelPriceModel } from "@/providers/database/mongodb/models/model-price";
import { cnyMicrosLabel } from "@/providers/billing/currency";

// 类型与 moneyMicros 定义在 client-safe 模块：client 组件（model-table 等）
// 必须从 public-model-types 引用，否则 Mongoose 代码会被打进客户端 bundle。
export { type PublicModel, type PublicChannelModel, type PublicChannel, moneyMicros } from "@/providers/catalog/public-model-types";

import { type PublicChannel, type PublicChannelModel, type PublicModel, moneyMicros } from "@/providers/catalog/public-model-types";

/** @deprecated Use `getPublicChannels()` instead — channel-first catalog. */
export async function getPublicModels(): Promise<PublicModel[]> {
  const [prices, channels] = await Promise.all([
    ModelPriceModel.find({ enabled: true }).sort({ model: 1 }).lean(),
    ChannelModel.find({ enabled: true }).select("models").lean(),
  ]);
  const routable = new Set(channels.flatMap((channel) => channel.models.map((mapping) => mapping.public)));
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

/** 渠道优先目录：以渠道为主键，每个渠道下列出可用模型（含价格）。 */
export async function getPublicChannels(): Promise<PublicChannel[]> {
  const [prices, channels] = await Promise.all([
    ModelPriceModel.find({ enabled: true }).lean(),
    ChannelModel.find({ enabled: true }).sort({ priority: 1 }).lean(),
  ]);
  const priceMap = new Map(prices.map((p) => [p.model, p]));
  return channels.map((channel) => ({
    channel: channel.name,
    priority: channel.priority,
    models: channel.models
      .filter((mapping) => priceMap.has(mapping.public))
      .map((mapping) => {
        const p = priceMap.get(mapping.public)!;
        return {
          model: mapping.public,
          inputPricePer1kMicros: p.inputPricePer1kMicros,
          outputPricePer1kMicros: p.outputPricePer1kMicros,
          cacheReadPricePer1kMicros: p.cacheReadPricePer1kMicros,
          cacheWritePricePer1kMicros: p.cacheWritePricePer1kMicros,
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

export async function getInternalModelSelectorData(): Promise<InternalModelSelectorData> {
  const channels = await getPublicChannels();
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
