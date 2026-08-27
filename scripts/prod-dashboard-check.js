// 验证看板两条聚合查询在生产库可跑通且有数据
const since24h = new Date(Date.now() - 86400000);
const usage = db.usages.aggregate([
  { $match: { createdAt: { $gte: since24h }, status: { $in: ["completed", "unsettled", "failed"] } } },
  { $group: { _id: null, requests: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } }, revenue: { $sum: "$chargedMicros" }, cost: { $sum: "$costMicros" } } },
]).toArray();
print("usage24h: " + JSON.stringify(usage));
const attempts = db.channelattempts.aggregate([
  { $match: { createdAt: { $gte: since24h } } },
  { $sort: { createdAt: -1 } },
  { $group: { _id: "$channelId", attempts: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } }, avgLatency: { $avg: "$latencyMs" }, lastError: { $first: "$error" } } },
]).toArray();
print("attempts24h: " + JSON.stringify(attempts, null, 1));
