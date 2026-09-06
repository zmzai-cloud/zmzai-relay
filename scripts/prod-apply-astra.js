/**
 * 生产：配置 gpt-6-astra（幂等，可重复执行）
 *
 * 卖价口径（用户 2026-09-07 拍板）：官方美元价数值 × 0.3，直填为「元/1M」
 *   官方 $10/$50 输入/输出、缓存读 $1 / 缓存写 $12.5
 *   → ¥3 / ¥15 每 1M；缓存读 ¥0.3 / 缓存写 ¥3.75
 *   换算：micros/1k = 元/1M × 125（¥1 = 125,000 micros，1M = 1000 × 1k）
 *
 * 成本口径：沿用各渠道既有规则 —— 成本 = 卖价 × 该渠道 costMultiplier
 *   （与 gpt-5.6-sol/terra/luna 在三条渠道上的记账方式完全一致：
 *    GPT-0.3x 8100 = 27000 × 0.3，GPT-0.21 5670 = 27000 × 0.21 …）
 *
 * 用法（key 不入仓，本脚本也不接触任何 key）：
 *   scp scripts/prod-apply-astra.js root@<host>:/tmp/
 *   ssh root@<host> "mongosh --quiet mongodb://127.0.0.1:27017/muzhi_production /tmp/prod-apply-astra.js"
 */
const MICROS_PER_YUAN_PER_1M = 125; // ¥/1M → micros/1k
const yuan = (per1M) => Math.round(per1M * MICROS_PER_YUAN_PER_1M);

const SELL = {
  input: yuan(3),        // ¥3/M   ← 官方 $10 × 0.3
  output: yuan(15),      // ¥15/M  ← 官方 $50 × 0.3
  cacheRead: yuan(0.3),  // ¥0.3/M ← 官方 $1 × 0.3
  cacheWrite: yuan(3.75),// ¥3.75/M← 官方 $12.5 × 0.3
};

const MODEL = "gpt-6-astra";
const CHANNELS = ["GPT-0.3x", "GPT-0.21", "GPT-0.03x-稳定性不保证"];

print(`=== 配置 ${MODEL} ===`);
print(`卖价 in=${SELL.input} out=${SELL.output} cacheRead=${SELL.cacheRead} cacheWrite=${SELL.cacheWrite} (micros/1k)`);
print(`  即 ¥${(SELL.input / 125).toFixed(2)} / ¥${(SELL.output / 125).toFixed(2)} 每 1M tokens`);
print("");

// ---------- 1. modelprice ----------
const before = db.modelprices.findOne({ model: MODEL });
if (before) {
  print(`[modelprice] 已存在，旧值 in=${before.inputPricePer1kMicros} out=${before.outputPricePer1kMicros}`);
} else {
  print("[modelprice] 不存在，将新建");
}

db.modelprices.updateOne(
  { model: MODEL },
  {
    $set: {
      inputPricePer1kMicros: SELL.input,
      outputPricePer1kMicros: SELL.output,
      cacheReadPricePer1kMicros: SELL.cacheRead,
      cacheWritePricePer1kMicros: SELL.cacheWrite,
      maxInputTokens: 1_050_000,   // 官方上下文窗口
      maxOutputTokens: 128_000,    // 官方最大输出
      allowedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      enabled: true,
    },
    $setOnInsert: { featured: false, featuredDescription: "", multiplier: 1 },
  },
  { upsert: true },
);
const price = db.modelprices.findOne({ model: MODEL });
print(`[modelprice] 现值 in=${price.inputPricePer1kMicros} out=${price.outputPricePer1kMicros} enabled=${price.enabled} ctx=${price.maxInputTokens} maxOut=${price.maxOutputTokens}`);
print(`[modelprice] 推理档位 ${(price.allowedReasoningEfforts || []).join("/")}`);
print("");

// ---------- 2. 渠道映射 + 模型级成本 ----------
for (const name of CHANNELS) {
  const channel = db.channels.findOne({ name });
  if (!channel) { print(`[${name}] ❌ 渠道不存在，跳过`); continue; }

  const mul = channel.costMultiplier ?? 1;
  const cost = {
    inputCostPer1kTokensMicros: Math.round(SELL.input * mul),
    outputCostPer1kTokensMicros: Math.round(SELL.output * mul),
  };

  const hasMapping = (channel.models || []).some((m) => m.public === MODEL);
  if (!hasMapping) {
    db.channels.updateOne(
      { name },
      { $push: { models: { public: MODEL, upstream: MODEL } } },
    );
  }
  db.channels.updateOne(
    { name },
    { $set: { [`modelCosts.${MODEL}`]: cost } },
  );
  const after = db.channels.findOne({ name });
  print(`[${name}] 映射 ${hasMapping ? "已存在" : "✅ 新增"} | 倍率 ×${mul} | 成本 in=${cost.inputCostPer1kTokensMicros} out=${cost.outputCostPer1kTokensMicros} (micros/1k)`);
  print(`          渠道模型数 ${(after.models || []).length}`);
}
print("");

// ---------- 3. 可路由性校验 ----------
// 三处齐查：modelprice.enabled + channel.enabled && 非冷却 + channel.models 有映射
const now = new Date();
const enabledChannels = db.channels
  .find({ enabled: true, $or: [{ cooldownUntil: null }, { cooldownUntil: { $lte: now } }] })
  .toArray();
const routable = enabledChannels.filter((c) => (c.models || []).some((m) => m.public === MODEL));
const margined = routable.map((c) => {
  const mc = (c.modelCosts || {})[MODEL];
  const costOut = mc?.outputCostPer1kTokensMicros ?? 0;
  return `${c.name} 毛利 ${((1 - costOut / SELL.output) * 100).toFixed(0)}%`;
});

print("=== 校验 ===");
print(`  modelprice.enabled = ${price.enabled}`);
print(`  可路由渠道 ${routable.length}/${enabledChannels.length}：${routable.map((c) => c.name).join(", ")}`);
print(`  ${margined.join(" | ")}`);
print(routable.length > 0 && price.enabled
  ? `  ✅ ${MODEL} 已上线，/v1/models 会返回`
  : `  ❌ 仍不可路由，检查渠道 enabled / 冷却状态`);
