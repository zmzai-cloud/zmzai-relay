// 只读：mimo 渠道完整配置（apiKey 只报有无，不打印）
const c = db.channels.findOne({ name: "mimo" });
if (!c) { print("mimo channel not found"); quit(1); }

print("name: " + c.name);
print("_id: " + c._id);
print("baseUrl: " + c.baseUrl);
print("enabled: " + c.enabled);
print("priority: " + c.priority);
print("timeoutMs: " + c.timeoutMs);
print("costMultiplier: " + c.costMultiplier);
print("executeMultiplier: " + c.executeMultiplier);
print("cooldownUntil: " + (c.cooldownUntil ? c.cooldownUntil.toISOString() : "null"));
print("hasApiKey: " + Boolean(c.apiKey) + " (len=" + (c.apiKey ? String(c.apiKey).length : 0) + ")");
print("models: " + JSON.stringify(c.models));
print("modelCosts: " + JSON.stringify(c.modelCosts));
print("channelCost: " + c.inputCostPer1kTokensMicros + "/" + c.outputCostPer1kTokensMicros +
      " cacheR=" + c.cacheReadCostPer1kTokensMicros + " cacheW=" + c.cacheWriteCostPer1kTokensMicros);

print("");
print("=== PRICE vs COST (micros/1k) ===");
db.modelprices.find({ model: /^mimo/i }).forEach((p) => {
  const mc = (c.modelCosts || {})[p.model];
  const costIn = mc ? mc.inputCostPer1kTokensMicros : c.inputCostPer1kTokensMicros;
  const costOut = mc ? mc.outputCostPer1kTokensMicros : c.outputCostPer1kTokensMicros;
  const effIn = Math.round(p.inputPricePer1kMicros * (c.executeMultiplier || 1));
  const effOut = Math.round(p.outputPricePer1kMicros * (c.executeMultiplier || 1));
  print(p.model + ": price=" + p.inputPricePer1kMicros + "/" + p.outputPricePer1kMicros +
        " execMul=" + c.executeMultiplier + " => charge=" + effIn + "/" + effOut +
        " | cost=" + costIn + "/" + costOut +
        " | marginIn=" + (effIn ? ((effIn - costIn) / effIn * 100).toFixed(1) : "n/a") + "%" +
        " marginOut=" + (effOut ? ((effOut - costOut) / effOut * 100).toFixed(1) : "n/a") + "%");
});

print("");
print("=== RECENT MIMO ATTEMPTS (24h) ===");
const since = new Date(Date.now() - 86400000);
const rows = db.channelattempts.find({ createdAt: { $gte: since }, channelId: c._id })
  .sort({ createdAt: -1 }).limit(10).toArray();
print("count(24h)=" + rows.length);
print(JSON.stringify(rows, null, 1));

print("");
print("=== RECENT MIMO USAGE (24h) ===");
const usages = db.usages.find({ createdAt: { $gte: since }, model: /^mimo/i }).sort({ createdAt: -1 }).limit(5).toArray();
print("count=" + usages.length);
print(JSON.stringify(usages, null, 1));
