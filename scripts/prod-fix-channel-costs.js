/**
 * 修正 deepseek-official / mimo 两条渠道的模型级成本（modelCosts）。
 *
 * 背景：这两条渠道的 modelCosts 恰好等于「卖价本身」（官方价的 8 倍），
 * 导致毛利恒为 0%。核查 providers/catalog/official-prices.ts 后确认，
 * 真实上游成本应为官方按量价，配置时误将卖价抄入了成本字段。
 *
 * 影响面：channelCosts 只进入 usage.costMicros（毛利记账），
 * 不影响 chargedMicros（用户实际扣费）。改配置只影响此后的调用，
 * 已结算的 usage 记录保持原样。
 *
 * 口径：1,000,000 micros = ¥8.00 → ¥1 = 125,000 micros → ¥/1M × 125 = micros/1k
 * 保守原则：DeepSeek 取高峰价（闲时减半，实际成本更低 → 毛利只会更高）。
 *
 * 幂等：可重复执行，成本已是目标值时跳过。
 */

const MICROS_PER_YUAN = 125000;
/** 元/1M tokens → micros/1k tokens */
const perK = (cnyPer1M) => Math.round(cnyPer1M * (MICROS_PER_YUAN / 1000));

// 数据源：providers/catalog/official-prices.ts（2026-08 更新）
const TARGET = {
  "deepseek-official": {
    "deepseek-v4-flash": { in: perK(3), out: perK(9), cacheR: perK(0.1), cacheW: 0 },
    "deepseek-v4-pro": { in: perK(9), out: perK(27), cacheR: perK(0.3), cacheW: 0 },
  },
  mimo: {
    "mimo-v2.5": { in: perK(1), out: perK(2), cacheR: perK(0.02), cacheW: 0 },
    "mimo-v2.5-pro": { in: perK(3), out: perK(6), cacheR: perK(0.025), cacheW: 0 },
  },
};

// 卖价（modelprice）用于算毛利，校验修正效果
const priceOf = (model) => db.modelprices.findOne({ model });

function yuan(microsPer1k) {
  return (microsPer1k * 1000) / MICROS_PER_YUAN;
}

let changed = 0;
let skipped = 0;

for (const [channelName, models] of Object.entries(TARGET)) {
  const channel = db.channels.findOne({ name: channelName });
  if (!channel) {
    print("❌ 渠道不存在：" + channelName);
    continue;
  }

  print("=== " + channelName + " (" + channel.baseUrl + ") ===");
  const modelCosts = channel.modelCosts || {};

  for (const [model, want] of Object.entries(models)) {
    const cur = modelCosts[model];
    // resolveChannelCosts 以 publicModel 为 key，确认映射存在
    const mapping = (channel.models || []).find((m) => m.public === model);
    if (!mapping) {
      print("  ⚠️ " + model + " 不在该渠道 models 映射中，跳过");
      continue;
    }

    const p = priceOf(model);
    const sellIn = p ? yuan(p.inputPricePer1kMicros) : null;
    const sellOut = p ? yuan(p.outputPricePer1kMicros) : null;

    const before = cur
      ? "in=¥" + yuan(cur.inputCostPer1kTokensMicros).toFixed(2) +
        " out=¥" + yuan(cur.outputCostPer1kTokensMicros).toFixed(2)
      : "(未配置)";
    const after = "in=¥" + yuan(want.in).toFixed(2) + " out=¥" + yuan(want.out).toFixed(2);

    const marginBefore = cur && sellOut ? ((1 - yuan(cur.outputCostPer1kTokensMicros) / sellOut) * 100).toFixed(1) + "%" : "n/a";
    const marginAfter = sellOut ? ((1 - yuan(want.out) / sellOut) * 100).toFixed(1) + "%" : "n/a";

    const same =
      cur &&
      cur.inputCostPer1kTokensMicros === want.in &&
      cur.outputCostPer1kTokensMicros === want.out &&
      (cur.cacheReadCostPer1kTokensMicros ?? 0) === want.cacheR;

    print("  " + model.padEnd(20));
    print("     卖价   in=¥" + (sellIn ?? 0).toFixed(2) + " out=¥" + (sellOut ?? 0).toFixed(2) + "/M");
    print("     成本前 " + before + "  毛利 " + marginBefore);
    print("     成本后 " + after + "  毛利 " + marginAfter +
      (same ? "   (已是目标值，跳过)" : ""));

    if (same) { skipped++; continue; }

    modelCosts[model] = {
      inputCostPer1kTokensMicros: want.in,
      outputCostPer1kTokensMicros: want.out,
      cacheReadCostPer1kTokensMicros: want.cacheR,
      cacheWriteCostPer1kTokensMicros: want.cacheW,
    };
    changed++;
  }

  db.channels.updateOne(
    { _id: channel._id },
    { $set: { modelCosts } },
  );
  print("");
}

print("=== 汇总 ===");
print("  修正 " + changed + " 项，跳过（已正确）" + skipped + " 项");

print("");
print("=== 复核：写入后的实际值 ===");
for (const [channelName, models] of Object.entries(TARGET)) {
  const c = db.channels.findOne({ name: channelName });
  for (const model of Object.keys(models)) {
    const v = (c.modelCosts || {})[model];
    const p = priceOf(model);
    if (!v || !p) continue;
    const mIn = 1 - yuan(v.inputCostPer1kTokensMicros) / yuan(p.inputPricePer1kMicros);
    const mOut = 1 - yuan(v.outputCostPer1kTokensMicros) / yuan(p.outputPricePer1kMicros);
    const ok = mIn > 0 && mOut > 0 ? "✅" : "❌倒挂";
    print("  " + (channelName + "/" + model).padEnd(38) +
      " 毛利 in=" + (mIn * 100).toFixed(1) + "% out=" + (mOut * 100).toFixed(1) + "% " + ok);
  }
}
