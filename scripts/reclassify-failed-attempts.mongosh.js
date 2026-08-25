// 一次性清理（mongosh 版）：failed+unknown 且未收费 → not_charged。
// 在 HK 服务器执行：scp 上传后
//   mongosh "mongodb://127.0.0.1:27017/muzhi_production" --quiet --eval 'var DRY_RUN = true' --file reclassify-failed-attempts.mongosh.js
const dbc = db.getSiblingDB("muzhi_production");
const dryRun = typeof DRY_RUN !== "undefined" ? DRY_RUN : true;

const attempts = dbc.channelattempts
  .find({ costStatus: "unknown", status: "failed" }, { usageId: 1, channelId: 1, upstreamModel: 1, error: 1, createdAt: 1 })
  .toArray();
const usageIds = attempts.map((a) => a.usageId);
const usages = dbc.usages.find({ _id: { $in: usageIds } }, { chargedMicros: 1 }).toArray();
const usageMap = new Map(usages.map((u) => [String(u._id), u.chargedMicros ?? 0]));

const toReclassify = attempts.filter((a) => (usageMap.get(String(a.usageId)) ?? 0) === 0);
const kept = attempts.filter((a) => !toReclassify.includes(a));

print("failed+unknown 总数:", attempts.length);
print("→ 将改为 not_charged（未收费）:", toReclassify.length);
print("→ 保留 unknown（已收费，潜在退款点）:", kept.length);
kept.forEach((a) =>
  print(
    "  保留:",
    new Date(a.createdAt).toISOString(),
    String(a.channelId).slice(0, 8),
    a.upstreamModel,
    "已收 ¥" + ((usageMap.get(String(a.usageId)) ?? 0) / 1e6).toFixed(4),
    a.error ?? "",
  ),
);

if (dryRun) {
  print("[DRY-RUN] 未执行更新");
} else if (toReclassify.length > 0) {
  const r = dbc.channelattempts.updateMany(
    { _id: { $in: toReclassify.map((a) => a._id) } },
    { $set: { costStatus: "not_charged" } },
  );
  print("更新:", r.modifiedCount, "笔");
} else {
  print("无符合条件的记录");
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
