import { cnyMicrosLabel } from "@/providers/billing/currency";

/**
 * 模型目录的纯类型与展示格式化 — 无服务端依赖，可安全被 client 组件引用。
 * 服务端查询在 public-models.ts（引了 Mongoose，禁止进入客户端 bundle）。
 */
export interface PublicModel {
  model: string;
  inputPricePer1kMicros: number;
  outputPricePer1kMicros: number;
  cacheReadPricePer1kMicros: number;
  cacheWritePricePer1kMicros: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  allowedReasoningEfforts: string[];
  routable: boolean;
}

export interface PublicChannelModel {
  model: string;
  inputPricePer1kMicros: number;
  outputPricePer1kMicros: number;
  cacheReadPricePer1kMicros: number;
  cacheWritePricePer1kMicros: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  allowedReasoningEfforts: string[];
  featured: boolean;
  featuredDescription: string;
}

export interface PublicChannel {
  channel: string;
  priority: number;
  models: PublicChannelModel[];
}

export function moneyMicros(value: number): string {
  return cnyMicrosLabel(value);
}
