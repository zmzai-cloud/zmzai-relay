import { model, models, Schema, type Model } from "mongoose";

export const reasoningEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

/** 默认模型种子（首次部署/seed 用）。运行时以 ModelPrice 集合中的记录为准，
 *  管理员可在「模型与价格」页面新增、编辑、启停模型，无需改代码。 */
export const seedModels = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "deepseek-v4-flash", "deepseek-v4-pro"] as const;
/** 兼容旧引用：已注册（存在价格记录）的模型即受支持的模型。 */
export const supportedModels = seedModels;
export type SupportedModel = (typeof supportedModels)[number];

export interface ModelPriceRecord {
  model: string;
  inputPricePer1kMicros: number;
  outputPricePer1kMicros: number;
  cacheReadPricePer1kMicros: number;
  cacheWritePricePer1kMicros: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  allowedReasoningEfforts: ReasoningEffort[];
  featured: boolean;
  featuredDescription: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ModelPriceRecord>({
  model: { type: String, required: true, trim: true, unique: true, maxlength: 120, match: /^[a-z0-9][a-z0-9._-]*$/i },
  inputPricePer1kMicros: { type: Number, required: true, min: 0 },
  outputPricePer1kMicros: { type: Number, required: true, min: 0 },
  cacheReadPricePer1kMicros: { type: Number, required: true, default: 0, min: 0 },
  cacheWritePricePer1kMicros: { type: Number, required: true, default: 0, min: 0 },
  maxInputTokens: { type: Number, required: true, min: 1, max: 2_000_000 },
  maxOutputTokens: { type: Number, required: true, min: 1, max: 500_000 },
  allowedReasoningEfforts: { type: [String], enum: reasoningEfforts, required: true, default: () => [...reasoningEfforts] },
  featured: { type: Boolean, required: true, default: false },
  featuredDescription: { type: String, required: true, default: "", maxlength: 200 },
  enabled: { type: Boolean, required: true, default: true },
}, { strict: "throw", timestamps: true });

export const ModelPriceModel =
  (models.ModelPrice as Model<ModelPriceRecord> | undefined) ?? model<ModelPriceRecord>("ModelPrice", schema);
