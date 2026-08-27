// 生产库现状盘点：模型价格 + 渠道配置（只读）
const models = db.modelprices.find({}, {
  model: 1, multiplier: 1, enabled: 1,
  inputPricePer1kMicros: 1, outputPricePer1kMicros: 1,
  cacheReadPricePer1kMicros: 1, cacheWritePricePer1kMicros: 1,
  maxInputTokens: 1, maxOutputTokens: 1,
}).toArray();
print("=== MODELS ===");
print(JSON.stringify(models, null, 1));

const channels = db.channels.find({}, {
  name: 1, priority: 1, enabled: 1, timeoutMs: 1,
  costMultiplier: 1, executeMultiplier: 1,
  inputCostPer1kTokensMicros: 1, outputCostPer1kTokensMicros: 1,
  cacheReadCostPer1kTokensMicros: 1, cacheWriteCostPer1kTokensMicros: 1,
  modelCosts: 1, models: 1,
}).toArray();
print("=== CHANNELS ===");
print(JSON.stringify(channels, null, 1));
