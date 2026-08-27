/** 官方价目表（2026-08 更新）。单位：元/1M tokens。仅用于管理后台算价/算成本参考，
 *  实际计费以 ModelPrice（模型面板）与 Channel 成本（渠道面板）记录为准。
 *  - GPT 系列官方为美元价，按 $1≈¥6.75 折算，note 标注官方美元价；
 *  - DeepSeek 为高峰价（北京时间周一至周五 9-12/14-18 点），闲时减半；缓存写官方不单独收费；
 *  - MiMo 缓存写限时免费；
 *  - 缓存字段缺失的模型（官方未公布）在「按倍率填充」时保持用户手填值。 */
export interface OfficialPrice {
  inputCnyPer1M: number;
  outputCnyPer1M: number;
  cacheReadCnyPer1M?: number;
  cacheWriteCnyPer1M?: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  note?: string;
}

export const OFFICIAL_PRICES: Record<string, OfficialPrice> = {
  "gpt-5.6-sol": { inputCnyPer1M: 27, outputCnyPer1M: 135, cacheReadCnyPer1M: 2.7, cacheWriteCnyPer1M: 33.75, maxInputTokens: 1_050_000, maxOutputTokens: 128_000, note: "$4/$20 促销至 11/21 · 缓存读 $0.4/写 $5" },
  "gpt-5.6-terra": { inputCnyPer1M: 13.5, outputCnyPer1M: 81, maxInputTokens: 1_000_000, maxOutputTokens: 128_000, note: "$2/$12" },
  "gpt-5.6-luna": { inputCnyPer1M: 1.35, outputCnyPer1M: 8.1, maxInputTokens: 1_000_000, maxOutputTokens: 128_000, note: "$0.2/$1.2" },
  "deepseek-v4-flash": { inputCnyPer1M: 3, outputCnyPer1M: 9, cacheReadCnyPer1M: 0.1, maxInputTokens: 1_000_000, maxOutputTokens: 384_000, note: "高峰价 · 缓存读 ¥0.1" },
  "deepseek-v4-pro": { inputCnyPer1M: 9, outputCnyPer1M: 27, cacheReadCnyPer1M: 0.3, maxInputTokens: 1_000_000, maxOutputTokens: 384_000, note: "高峰价 · 缓存读 ¥0.3" },
  "mimo-v2.5": { inputCnyPer1M: 1, outputCnyPer1M: 2, cacheReadCnyPer1M: 0.02, maxInputTokens: 1_000_000, maxOutputTokens: 131_072, note: "缓存读 ¥0.02" },
  "mimo-v2.5-pro": { inputCnyPer1M: 3, outputCnyPer1M: 6, cacheReadCnyPer1M: 0.025, maxInputTokens: 1_000_000, maxOutputTokens: 131_072, note: "缓存读 ¥0.025" },
};
