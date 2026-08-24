import {
  model,
  models,
  Schema,
  type HydratedDocument,
  type Model,
  type Types,
} from "mongoose";

import { currentPeriod } from "@/providers/billing/period";

/** Relay 发给调用方的 API key。 **/
export interface ApiKeyRecord {
  keyHash: string;             // sha256，select:false，唯一索引
  prefix: string;              // "zrk_ab12cd34" 前 12 位，展示/检索用
  name: string;                // 备注 "muzhi 后端" / "张三"
  userId: Types.ObjectId; // 归属 muzhi 用户
  status: "active" | "revoked";
  quotaTotalTokens: number;
  quotaUsedTokens: number;
  rateLimitPerMinute: number;
  allowedModels: string[];     // 空=全部
  monthlySpendLimitMicros: number; // 0=不限
  monthlySpendUsedMicros: number;
  monthlySpendReservedMicros: number;
  monthlySpendPeriod: string; // Asia/Shanghai YYYY-MM
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ApiKeyDocument = HydratedDocument<ApiKeyRecord>;

const apiKeySchema = new Schema<ApiKeyRecord>(
  {
    keyHash: { type: String, required: true, select: false },
    prefix: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["active", "revoked"], required: true, default: "active" },
    quotaTotalTokens: { type: Number, required: true, default: 0, min: 0 },
    quotaUsedTokens: { type: Number, required: true, default: 0, min: 0 },
    rateLimitPerMinute: { type: Number, required: true, default: 60, min: 1 },
    allowedModels: { type: [String], required: true, default: [] },
    monthlySpendLimitMicros: { type: Number, required: true, default: 0, min: 0 },
    monthlySpendUsedMicros: { type: Number, required: true, default: 0, min: 0 },
    monthlySpendReservedMicros: { type: Number, required: true, default: 0, min: 0 },
    monthlySpendPeriod: { type: String, required: true, default: () => currentPeriod() },
    lastUsedAt: { type: Date, default: null },
  },
  { strict: "throw", timestamps: true },
);

apiKeySchema.index({ keyHash: 1 }, { unique: true });

export const ApiKeyModel =
  (models.ApiKey as Model<ApiKeyRecord> | undefined) ??
  model<ApiKeyRecord>("ApiKey", apiKeySchema);
