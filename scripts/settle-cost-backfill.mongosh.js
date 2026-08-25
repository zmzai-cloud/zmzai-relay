// 一次性清理（mongosh 版）：8/6 completed 缺口按 usages 回填 + luna 已收费失败退款。
// 在 HK 服务器执行：scp 上传后
//   mongosh "mongodb://127.0.0.1:27017/muzhi_production" --quiet --eval 'var DRY_RUN = true' --file settle-cost-backfill.mongosh.js
const dbc = db.getSiblingDB("muzhi_production");
const dryRun = typeof DRY_RUN !== "undefined" ? DRY_RUN : true;

function microsToYuan(m) {
  return ((m ?? 0) / 1e6).toFixed(4);
}

// ---- 1) 8/6 completed + unknown 缺口 ----
const completedUnknown = dbc.channelattempts
  .find({ costStatus: "unknown", status: "completed" })
  .toArray();
const completedUsageIds = completedUnknown.map((a) => a.usageId);
const completedUsages = dbc.usages.find({ _id: { $in: completedUsageIds } }, { chargedMicros: 1 }).toArray();
const completedUsageMap = new Map(completedUsages.map((u) => [String(u._id), u.chargedMicros ?? 0]));

print("== 8/6 completed + unknown 缺口:", completedUnknown.length, "笔 ==");
completedUnknown.forEach((a) =>
  print(
    " ",
    new Date(a.createdAt).toISOString().slice(0, 16),
    "attempt=" + String(a._id).slice(-6),
    "usage=" + String(a.usageId ?? "").slice(-6),
    "channel=" + String(a.channelId).slice(0, 8),
    a.upstreamModel ?? "",
    "已收 ¥" + microsToYuan(completedUsageMap.get(String(a.usageId))),
    "keys=" + JSON.stringify(Object.keys(a).filter((k) => /cost|charge|fee|price/i.test(k))),
  ),
);

// ---- 2) luna 已收费失败退款点 ----
const lunaFailed = dbc.channelattempts
  .find({ costStatus: "unknown", status: "failed" }, { usageId: 1, channelId: 1, upstreamModel: 1, error: 1, createdAt: 1 })
  .toArray();
const lunaUsageIds = lunaFailed.map((a) => a.usageId);
const lunaUsages = dbc.usages.find({ _id: { $in: lunaUsageIds } }, { chargedMicros: 1 }).toArray();
const lunaUsageMap = new Map(lunaUsages.map((u) => [String(u._id), u.chargedMicros ?? 0]));
const chargedLuna = lunaFailed.filter((a) => (lunaUsageMap.get(String(a.usageId)) ?? 0) > 0);

print("== 已收费失败（潜在退款）:", chargedLuna.length, "笔 ==");
chargedLuna.forEach((a) =>
  print(
    " ",
    new Date(a.createdAt).toISOString().slice(0, 16),
    "attempt=" + String(a._id).slice(-6),
    "usage=" + String(a.usageId).slice(-6),
    "channel=" + String(a.channelId).slice(0, 8),
    a.upstreamModel ?? "",
    "已收 ¥" + microsToYuan(lunaUsageMap.get(String(a.usageId))),
    a.error ?? "",
  ),
);

if (dryRun) {
  print("[DRY-RUN] 未执行任何更新");
} else {
  // 回填 completed 缺口：有 usage 收费 → charged + costMicros；无收费 → not_charged
  const toCharge = [];
  const toNotCharge = [];
  for (const a of completedUnknown) {
    const micros = completedUsageMap.get(String(a.usageId)) ?? 0;
    if (micros > 0) toCharge.push({ id: a._id, micros });
    else toNotCharge.push(a._id);
  }
  let charged = 0;
  for (const item of toCharge) {
    const r = dbc.channelattempts.updateOne(
      { _id: item.id },
      { $set: { costStatus: "charged", costMicros: item.micros } },
    );
    charged += r.modifiedCount;
  }
  let notCharged = 0;
  if (toNotCharge.length > 0) {
    const r = dbc.channelattempts.updateMany(
      { _id: { $in: toNotCharge } },
      { $set: { costStatus: "not_charged" } },
    );
    notCharged = r.modifiedCount;
  }
  print("回填 charged:", charged, "笔（含 costMicros）");
  print("回填 not_charged:", notCharged, "笔");

  // 删除 luna 已收费失败记录（用户确认：直接删除）
  const r = dbc.channelattempts.deleteMany({ _id: { $in: chargedLuna.map((a) => a._id) } });
  print("删除 luna 已收费失败记录:", r.deletedCount, "笔");
}

print("剩余 unknown:", dbc.channelattempts.countDocuments({ costStatus: "unknown" }), "笔");
print(
  "剩余构成:",
  JSON.stringify(
    dbc.channelattempts
      .aggregate([
        { $match: { costStatus: "unknown" } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray(),
  ),
);
