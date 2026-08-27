import {
  model,
  models,
  Schema,
  type HydratedDocument,
  type Model,
} from "mongoose";

export const channelProtocols = ["openai-compat"] as const;
export type ChannelProtocol = (typeof channelProtocols)[number];

/** 对外统一模型名 → 上游实际模型名 的一条映射。 */
export interface ModelMapping {
  public: string;    // 对外 "gpt-5.6-terra"
  upstream: string;  // 上游实际 "gpt-5.6-terra"
}

/** 模型级成本覆盖：同一渠道内不同模型单价不同时用（如 deepseek 的 flash/pro）。 */
export interface ModelCostOverride {
  inputCostPer1kTokensMicros: number;
  outputCostPer1kTokensMicros: number;
  cacheReadCostPer1kTokensMicros?: number;
  cacheWriteCostPer1kTokensMicros?: number;
}

export interface ChannelCosts {
  inputCostPer1kTokensMicros: number;
  outputCostPer1kTokensMicros: number;
  cacheReadCostPer1kTokensMicros: number;
  cacheWriteCostPer1kTokensMicros: number;
}

/** 取某模型在该渠道的有效成本：模型级覆盖优先，回退渠道级；渠道级未配置返回 null。 */
export function resolveChannelCosts(
  channel: Pick<ChannelRecord, "inputCostPer1kTokensMicros" | "outputCostPer1kTokensMicros" | "cacheReadCostPer1kTokensMicros" | "cacheWriteCostPer1kTokensMicros" | "modelCosts">,
  publicModel: string,
): ChannelCosts | null {
  const override = channel.modelCosts?.[publicModel];
  if (override) {
    return {
      inputCostPer1kTokensMicros: override.inputCostPer1kTokensMicros,
      outputCostPer1kTokensMicros: override.outputCostPer1kTokensMicros,
      cacheReadCostPer1kTokensMicros: override.cacheReadCostPer1kTokensMicros ?? 0,
      cacheWriteCostPer1kTokensMicros: override.cacheWriteCostPer1kTokensMicros ?? 0,
    };
  }
  if (channel.inputCostPer1kTokensMicros === null || channel.outputCostPer1kTokensMicros === null) return null;
  return {
    inputCostPer1kTokensMicros: channel.inputCostPer1kTokensMicros,
    outputCostPer1kTokensMicros: channel.outputCostPer1kTokensMicros,
    cacheReadCostPer1kTokensMicros: channel.cacheReadCostPer1kTokensMicros ?? 0,
    cacheWriteCostPer1kTokensMicros: channel.cacheWriteCostPer1kTokensMicros ?? 0,
  };
}

/** 上游中转站渠道（admin 配置）。 */
export interface ChannelRecord {
  name: string;               // 备注哪个站 "cheap-a"
  baseUrl: string;            // "https://api.cheap-a.com/v1"
  apiKey: string;             // 上游 key，select:false，不明文返回
  protocol: ChannelProtocol;
  models: ModelMapping[];
  priority: number;           // 小=优先（便宜的排前）
  inputCostPer1kTokensMicros: number | null;
  outputCostPer1kTokensMicros: number | null;
  cacheReadCostPer1kTokensMicros: number | null;
  cacheWriteCostPer1kTokensMicros: number | null;
  modelCosts: Record<string, ModelCostOverride>;
  /** 成本倍率：管理后台按「官方价 × 倍率」自动填充成本（与模型面板的标准价倍率对应） */
  costMultiplier: number;
  /** 执行倍率：对用户实际收费 = 模型标准价 × 执行倍率（渠道按官方标准价折扣销售时配置） */
  executeMultiplier: number;
  enabled: boolean;
  timeoutMs: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ChannelDocument = HydratedDocument<ChannelRecord>;

const modelMappingSchema = new Schema<ModelMapping>(
  {
    public: { type: String, required: true, trim: true },
    upstream: { type: String, required: true, trim: true },
  },
  { _id: false, strict: "throw" },
);

const channelSchema = new Schema<ChannelRecord>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    baseUrl: { type: String, required: true, trim: true, maxlength: 500 },
    apiKey: { type: String, required: true, select: false },
    protocol: {
      type: String,
      enum: channelProtocols,
      required: true,
      default: "openai-compat",
    },
    models: { type: [modelMappingSchema], required: true, default: [] },
    priority: { type: Number, required: true, default: 10 },
    inputCostPer1kTokensMicros: { type: Number, default: null, min: 0 },
    outputCostPer1kTokensMicros: { type: Number, default: null, min: 0 },
    cacheReadCostPer1kTokensMicros: { type: Number, default: null, min: 0 },
    cacheWriteCostPer1kTokensMicros: { type: Number, default: null, min: 0 },
    /* 用 Mixed 而非 Map：lean() 与 JSON 序列化都得到纯对象，admin API 直接透传 */
    modelCosts: { type: Schema.Types.Mixed, default: {} },
    costMultiplier: { type: Number, required: true, default: 1, min: 0.01, max: 100 },
    executeMultiplier: { type: Number, required: true, default: 1, min: 0.01, max: 100 },
    enabled: { type: Boolean, required: true, default: true },
    timeoutMs: { type: Number, required: true, default: 60000, min: 1000 },
  },
  { strict: "throw", timestamps: true },
);

export const ChannelModel =
  (models.Channel as Model<ChannelRecord> | undefined) ??
  model<ChannelRecord>("Channel", channelSchema);
