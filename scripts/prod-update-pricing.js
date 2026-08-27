// P0 定价落地（mongosh 脚本）：
// 1) 模型标准价 = 官方价（multiplier=1）；官方未公布的缓存字段保持现值
// 2) 渠道成本 = 官方价 × 真实拿货折扣（GPT 按渠道名 0.21/0.3/0.03，deepseek/mimo 原价）
// 3) 执行倍率：GPT 渠道 0.6（50% 毛利），deepseek/mimo 2
// 单位：DB 微元/1k tokens = 元/1M × 1000
const OFFICIAL = {
  "gpt-5.6-sol":   { input: 27000, output: 135000, cr: 2700, cw: 33750, maxIn: 1050000, maxOut: 128000 },
  "gpt-5.6-terra": { input: 13500, output: 81000,  cr: null, cw: null,  maxIn: 1000000, maxOut: 128000 },
  "gpt-5.6-luna":  { input: 1350,  output: 8100,   cr: null, cw: null,  maxIn: 1000000, maxOut: 128000 },
  "deepseek-v4-flash": { input: 3000, output: 9000,  cr: 100, cw: null, maxIn: 1000000, maxOut: 384000 },
  "deepseek-v4-pro":   { input: 9000, output: 27000, cr: 300, cw: null, maxIn: 1000000, maxOut: 384000 },
  "mimo-v2.5":     { input: 1000, output: 2000, cr: 20, cw: null, maxIn: 1000000, maxOut: 131072 },
  "mimo-v2.5-pro": { input: 3000, output: 6000, cr: 25, cw: null, maxIn: 1000000, maxOut: 131072 },
};

print("=== 1) 模型标准价 → 官方价 ===");
for (const [name, p] of Object.entries(OFFICIAL)) {
  const set = {
    inputPricePer1kMicros: p.input,
    outputPricePer1kMicros: p.output,
    multiplier: 1,
    maxInputTokens: p.maxIn,
    maxOutputTokens: p.maxOut,
  };
  if (p.cr !== null) set.cacheReadPricePer1kMicros = p.cr;
  if (p.cw !== null) set.cacheWritePricePer1kMicros = p.cw;
  const r = db.modelprices.updateOne({ model: name }, { $set: set });
  print(`${name}: matched=${r.matchedCount} modified=${r.modifiedCount}`);
}

/** 官方价 × 折扣 → 模型级成本覆盖 */
function costOverride(model, rate) {
  const p = OFFICIAL[model];
  if (!p) throw new Error("unknown model: " + model);
  return {
    inputCostPer1kTokensMicros: Math.round(p.input * rate),
    outputCostPer1kTokensMicros: Math.round(p.output * rate),
    cacheReadCostPer1kTokensMicros: p.cr !== null ? Math.round(p.cr * rate) : 0,
    cacheWriteCostPer1kTokensMicros: p.cw !== null ? Math.round(p.cw * rate) : 0,
  };
}

print("=== 2) 渠道成本倍率 + 执行倍率 ===");
const plans = [
  { name: "GPT-0.21", rate: 0.21, exec: 0.6 },
  { name: "GPT-0.3x", rate: 0.3, exec: 0.6 },
  { name: "GPT-0.03x-稳定性不保证", rate: 0.03, exec: 0.6 },
  { name: "deepseek-official", rate: 1, exec: 2 },
  { name: "mimo", rate: 1, exec: 2 },
];
for (const plan of plans) {
  const ch = db.channels.findOne({ name: plan.name });
  if (!ch) { print(`${plan.name}: NOT FOUND, skip`); continue; }
  const modelCosts = {};
  for (const m of ch.models || []) modelCosts[m.public] = costOverride(m.public, plan.rate);
  const first = (ch.models || [])[0];
  const fallback = first ? costOverride(first.public, plan.rate) : null;
  const set = {
    costMultiplier: plan.rate,
    executeMultiplier: plan.exec,
    modelCosts: modelCosts,
  };
  if (fallback) {
    // 渠道级成本作回退展示（模型级覆盖优先），取第一个映射模型的值
    set.inputCostPer1kTokensMicros = fallback.inputCostPer1kTokensMicros;
    set.outputCostPer1kTokensMicros = fallback.outputCostPer1kTokensMicros;
    set.cacheReadCostPer1kTokensMicros = fallback.cacheReadCostPer1kTokensMicros;
    set.cacheWriteCostPer1kTokensMicros = fallback.cacheWriteCostPer1kTokensMicros;
  }
  const r = db.channels.updateOne({ _id: ch._id }, { $set: set });
  print(`${plan.name}: cost=${plan.rate} exec=${plan.exec} modified=${r.modifiedCount} models=${Object.keys(modelCosts).join(",")}`);
}

print("=== 3) 验证回读 ===");
db.modelprices.find({}, { model: 1, inputPricePer1kMicros: 1, outputPricePer1kMicros: 1, cacheReadPricePer1kMicros: 1, multiplier: 1 }).forEach((m) => {
  print(`${m.model}: in=${m.inputPricePer1kMicros} out=${m.outputPricePer1kMicros} cr=${m.cacheReadPricePer1kMicros} mult=${m.multiplier}`);
});
db.channels.find({}, { name: 1, costMultiplier: 1, executeMultiplier: 1, inputCostPer1kTokensMicros: 1 }).forEach((c) => {
  print(`${c.name}: costMult=${c.costMultiplier} execMult=${c.executeMultiplier} chCost=${c.inputCostPer1kTokensMicros}`);
});
