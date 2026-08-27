import { z } from "zod";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ModelPriceModel } from "@/providers/database/mongodb/models/model-price";

const channelConfigFields = {
  name: z.string().min(1).max(80),
  baseUrl: z.string().url().max(500),
  // public 必须是已注册模型（ModelPrice 集合中存在）；存在性由创建/更新路由异步校验
  models: z.array(z.object({ public: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/i), upstream: z.string().min(1).max(200) })).min(1),
  priority: z.coerce.number().int().min(0),
  inputCostPer1kTokensMicros: z.number().int().min(0).nullable(),
  outputCostPer1kTokensMicros: z.number().int().min(0).nullable(),
  cacheReadCostPer1kTokensMicros: z.number().int().min(0).nullable().default(null),
  cacheWriteCostPer1kTokensMicros: z.number().int().min(0).nullable().default(null),
  // 模型级成本覆盖：同一渠道内不同模型单价不同时用（如 deepseek 的 flash/pro）
  modelCosts: z.record(z.object({
    inputCostPer1kTokensMicros: z.number().int().min(0),
    outputCostPer1kTokensMicros: z.number().int().min(0),
    cacheReadCostPer1kTokensMicros: z.number().int().min(0).optional(),
    cacheWriteCostPer1kTokensMicros: z.number().int().min(0).optional(),
  })).default({}),
  // 成本倍率：官方价 × 倍率 = 成本（与模型面板标准价倍率对应，仅作管理后台自动填充依据）
  costMultiplier: z.coerce.number().min(0.01).max(100).default(1),
  // 执行倍率：对用户实际收费 = 模型标准价 × 执行倍率（渠道按官方标准价折扣销售时配置）
  executeMultiplier: z.coerce.number().min(0.01).max(100).default(1),
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(300000),
};

function validateCosts(value: { inputCostPer1kTokensMicros: number | null; outputCostPer1kTokensMicros: number | null }, context: z.RefinementCtx) {
  if ((value.inputCostPer1kTokensMicros === null) !== (value.outputCostPer1kTokensMicros === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "输入和输出成本必须同时配置或同时留空" });
  }
}

export const channelConfigSchema = z.object(channelConfigFields).strict().superRefine(validateCosts);
export const channelCreateSchema = z.object({ ...channelConfigFields, apiKey: z.string().min(1) }).strict().superRefine(validateCosts);

/** 校验 models[].public 均已注册（ModelPrice 集合存在记录），返回缺失的模型名。 */
export async function assertModelsRegistered(publics: string[]): Promise<string[]> {
  await connectMongo();
  const found = await ModelPriceModel.find({ model: { $in: [...new Set(publics)] } }).select("model").lean();
  const foundSet = new Set(found.map((m) => m.model));
  return [...new Set(publics)].filter((name) => !foundSet.has(name));
}
