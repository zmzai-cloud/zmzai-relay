// 只读：全量毛利复核。口径与 resolveChannelCosts 一致（modelCosts 以 publicModel 为 key）
const MICROS_PER_YUAN = 125000;
const perM = (microsPer1k) => (microsPer1k * 1000) / MICROS_PER_YUAN;

const channels = db.channels.find({ enabled: true }).toArray();
const prices = {};
db.modelprices.find({}).forEach(p => { prices[p.model] = p; });

let bad = [], noCost = [], worst = null;

print("模型".padEnd(24) + "渠道".padEnd(20) + " 卖(out ¥/M)  成本(out ¥/M)  毛利");
print("-".repeat(78));

for (const m of Object.keys(prices).sort()) {
  const p = prices[m];
  const sellIn = perM(p.inputPricePer1kMicros);
  const sellOut = perM(p.outputPricePer1kMicros);
  for (const c of channels) {
    if (!(c.models || []).some(x => x.public === m)) continue;
    const mc = (c.modelCosts || {})[m];
    let costIn, costOut, src;
    if (mc && mc.inputCostPer1kTokensMicros != null) {
      costIn = perM(mc.inputCostPer1kTokensMicros);
      costOut = perM(mc.outputCostPer1kTokensMicros);
      src = "model";
    } else if (c.inputCostPer1kTokensMicros != null) {
      const mul = c.costMultiplier ?? 1;
      costIn = perM(c.inputCostPer1kTokensMicros * mul);
      costOut = perM(c.outputCostPer1kTokensMicros * mul);
      src = "channel";
    } else {
      costIn = 0; costOut = 0; src = "NONE";
      noCost.push(m + "@" + c.name);
    }
    const mOut = sellOut > 0 ? 1 - costOut / sellOut : null;
    const mIn = sellIn > 0 ? 1 - costIn / sellIn : null;
    const flag = (src !== "NONE" && (mOut < 0 || mIn < 0)) ? "  ❌倒挂" : (src === "NONE" ? "  ⚠️无成本" : "");
    if (flag.includes("倒挂")) bad.push(m + "@" + c.name);
    if (src !== "NONE" && mOut != null && (worst === null || mOut < worst.m)) worst = { label: m + "@" + c.name, m: mOut };
    print(m.padEnd(24) + c.name.padEnd(20) +
      " ¥" + sellOut.toFixed(2).padStart(9) +
      "  ¥" + costOut.toFixed(2).padStart(10) +
      "   " + (mOut == null ? "n/a" : (mOut*100).toFixed(1) + "%").padStart(7) + flag);
  }
}
print("");
print("=== 结论 ===");
print("  倒挂（亏本）项：" + (bad.length ? "❌ " + bad.join(", ") : "✅ 无"));
print("  无成本记录项：" + (noCost.length ? "⚠️ " + noCost.join(", ") : "✅ 无"));
if (worst) print("  最低毛利：" + worst.label + " → " + (worst.m*100).toFixed(1) + "%");
