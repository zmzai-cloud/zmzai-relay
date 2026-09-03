// 生产变更：新增火山方舟 Coding Plan 渠道（ark） + 14 个新 modelprice 记录
// - channel: ark, baseUrl=https://ark.cn-beijing.volces.com/api/coding/v3, Coding Plan 专用端点
// - 模型：实测 key 支持 15 个；deepseek-v4-flash/pro 复用现有 modelprice（不调整）
// - 卖价 = 官方价 ×2；channel cost = 官方价 ×1（毛利 50%）；cacheR/cacheW 见下表
// - apiKey 来自环境变量 ARK_API_KEY（由 bash 包装器从 stdin 注入，本文件不保存 key）
// - 幂等：重复执行不报错，覆盖已存在记录

const KEY = process.env.ARK_API_KEY;
if (!KEY) { print("ERROR: 环境变量 ARK_API_KEY 未设置"); quit(1); }
if (!/^ark-[a-z0-9-]+$/i.test(KEY)) { print("ERROR: key 格式不像火山方舟 ark-*"); quit(1); }

const now = () => new Date();
const yPerMTokens = (y) => Math.round(y * 125); // ¥/M tokens → micros/1k tokens  （1,000,000 micros=¥8，¥1=125000 micros）
const upsertModel = (m) => {
  const existing = db.modelprices.findOne({ model: m.model });
  if (existing) {
    db.modelprices.updateOne({ model: m.model }, { $set: m });
    print("  [model] update  " + m.model);
  } else {
    db.modelprices.insertOne({ ...m, createdAt: now(), updatedAt: now() });
    print("  [model] insert  " + m.model);
  }
};

// === 新增的 14 个 modelprice（卖价 = 官方价 ×2，单位 micros/1k tokens） ===
// doubao-seed-evolving 官方价按 doubao-seed-2.1-pro (¥3/¥15) 口径估算（公开资料未单列）
// minmax/glm/kimi 按已知的开放平台按量价 ×2（火山 Coding Plan 内 AFP 不透明，按市场公开价近似）
const newModels = [
  { model: "doubao-seed-2.0-mini",   in: yPerMTokens(0.2),  out: yPerMTokens(2.0),  cacheR: yPerMTokens(0.08), maxIn: 256000,  maxOut: 65000,  enabled: true,  featured: false, desc: "" },
  { model: "doubao-seed-2.0-lite",   in: yPerMTokens(0.6),  out: yPerMTokens(3.6),  cacheR: yPerMTokens(0.24), maxIn: 256000,  maxOut: 65000,  enabled: true,  featured: false, desc: "" },
  { model: "doubao-seed-2.0-code",   in: yPerMTokens(6.4),  out: yPerMTokens(32.0), cacheR: yPerMTokens(1.28), maxIn: 256000,  maxOut: 128000, enabled: true,  featured: false, desc: "" },
  { model: "doubao-seed-2.0-pro",    in: yPerMTokens(6.4),  out: yPerMTokens(32.0), cacheR: yPerMTokens(1.28), maxIn: 256000,  maxOut: 128000, enabled: true,  featured: true,  desc: "豆包旗舰推理，面向 Agent 与长链路任务" },
  { model: "doubao-seed-2.1-turbo",  in: yPerMTokens(3.0),  out: yPerMTokens(15.0), cacheR: yPerMTokens(1.2),  maxIn: 256000,  maxOut: 65000,  enabled: true,  featured: false, desc: "" },
  { model: "doubao-seed-evolving",   in: yPerMTokens(6.0),  out: yPerMTokens(30.0), cacheR: yPerMTokens(2.4),  maxIn: 1024000, maxOut: 65000,  enabled: true,  featured: false, desc: "" },
  { model: "minimax-m2.7",          in: yPerMTokens(2.0),  out: yPerMTokens(16.0), cacheR: yPerMTokens(2.0),  maxIn: 200000,  maxOut: 128000, enabled: true,  featured: false, desc: "" },
  { model: "minimax-m3",            in: yPerMTokens(4.0),  out: yPerMTokens(16.0), cacheR: yPerMTokens(2.0),  maxIn: 1024000, maxOut: 128000, enabled: true,  featured: true,  desc: "MiniMax M3 多模态，文图共享额度" },
  { model: "glm-5.2",               in: yPerMTokens(2.0),  out: yPerMTokens(8.0),  cacheR: yPerMTokens(1.0),  maxIn: 1024000, maxOut: 128000, enabled: true,  featured: false, desc: "" },
  { model: "glm-5.3",               in: yPerMTokens(2.0),  out: yPerMTokens(8.0),  cacheR: yPerMTokens(1.0),  maxIn: 1024000, maxOut: 128000, enabled: true,  featured: false, desc: "" },
  { model: "kimi-k2.6",             in: yPerMTokens(4.0),  out: yPerMTokens(16.0), cacheR: yPerMTokens(2.0),  maxIn: 256000,  maxOut: 32000,  enabled: true,  featured: false, desc: "" },
  { model: "kimi-k2.7-code",        in: yPerMTokens(4.0),  out: yPerMTokens(16.0), cacheR: yPerMTokens(2.0),  maxIn: 256000,  maxOut: 32000,  enabled: true,  featured: false, desc: "" },
  { model: "ark-code-latest",       in: yPerMTokens(6.4),  out: yPerMTokens(32.0), cacheR: yPerMTokens(1.28), maxIn: 256000,  maxOut: 32000,  enabled: true,  featured: false, desc: "方舟智能路由（当前指向 doubao-seed-2.0-code）" },
];

// deepseek-v4-flash/pro 复用：modelprice 已有卖价 in=3000/9000 micros/1k = ¥12/¥36 per M
// ark 渠道作为 fallback 也把它们挂上，成本按公开 deepseek API 官方价（估算 ¥4/¥16 per M）
const DEEPEEK_COST_IN = yPerMTokens(4.0);
const DEEPEEK_COST_OUT = yPerMTokens(16.0);

print("########## 1. UPSERT MODELPRICES ##########");
for (const spec of newModels) {
  const rec = {
    model: spec.model,
    multiplier: 1,
    inputPricePer1kMicros: spec.in,
    outputPricePer1kMicros: spec.out,
    cacheReadPricePer1kMicros: spec.cacheR,
    cacheWritePricePer1kMicros: 0,
    maxInputTokens: spec.maxIn,
    maxOutputTokens: spec.maxOut,
    allowedReasoningEfforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
    featured: spec.featured,
    featuredDescription: spec.desc,
    enabled: spec.enabled,
    updatedAt: now(),
  };
  upsertModel(rec);
}

print("");
print("########## 2. UPSERT CHANNEL 'ark' ##########");
const modelMappings = [
  ...newModels.map((m) => ({ public: m.model, upstream: m.model })),
  { public: "deepseek-v4-flash", upstream: "deepseek-v4-flash" },
  { public: "deepseek-v4-pro",   upstream: "deepseek-v4-pro"   },
];

// 各模型成本（官方价 ×1）：卖价 = 官方价 ×2 → 毛利 50%
const modelCosts = {};
for (const m of newModels) {
  modelCosts[m.model] = {
    inputCostPer1kTokensMicros: Math.round(m.in / 2),
    outputCostPer1kTokensMicros: Math.round(m.out / 2),
    cacheReadCostPer1kTokensMicros: Math.round(m.cacheR / 2),
    cacheWriteCostPer1kTokensMicros: 0,
  };
}
modelCosts["deepseek-v4-flash"] = { inputCostPer1kTokensMicros: DEEPEEK_COST_IN, outputCostPer1kTokensMicros: DEEPEEK_COST_OUT, cacheReadCostPer1kTokensMicros: 0, cacheWriteCostPer1kTokensMicros: 0 };
modelCosts["deepseek-v4-pro"]   = { inputCostPer1kTokensMicros: DEEPEEK_COST_IN, outputCostPer1kTokensMicros: DEEPEEK_COST_OUT, cacheReadCostPer1kTokensMicros: 0, cacheWriteCostPer1kTokensMicros: 0 };

const existing = db.channels.findOne({ name: "ark" });
const channelDoc = {
  name: "ark",
  baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
  apiKey: KEY,
  models: modelMappings,
  priority: 10,
  inputCostPer1kTokensMicros: null,
  outputCostPer1kTokensMicros: null,
  cacheReadCostPer1kTokensMicros: null,
  cacheWriteCostPer1kTokensMicros: null,
  modelCosts,
  costMultiplier: 1,
  executeMultiplier: 1, // 卖价已在 modelprice 中含 ×2，不再加乘
  enabled: true,
  timeoutMs: 60000,
  updatedAt: now(),
};
if (existing) {
  db.channels.updateOne({ name: "ark" }, { $set: channelDoc });
  print("  [channel] update  ark (id=" + existing._id + ")");
} else {
  db.channels.insertOne({ ...channelDoc, createdAt: now() });
  print("  [channel] insert  ark");
}

print("");
print("########## 3. VERIFY ROUTABLE ##########");
const ch = db.channels.findOne({ name: "ark" });
let n = 0, nRoutable = 0;
for (const m of ch.models) {
  const p = db.modelprices.findOne({ model: m.public });
  const hasCost = ch.modelCosts && ch.modelCosts[m.public];
  const routable = p && p.enabled && ch.enabled && hasCost && !ch.cooldownUntil;
  if (routable) nRoutable++;
  n++;
  print("  " + m.public.padEnd(30) + " price=" + (p ? p.enabled : "NO_MODEL") +
        " cost=" + (hasCost ? "OK" : "MISSING"));
}
print("");
print("routable: " + nRoutable + " / " + n);
print("key bytes: " + KEY.length + " (set; will not be printed)");