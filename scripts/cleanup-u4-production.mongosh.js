// 一次性生产数据清理（mongosh 版）：u4 = 旧 protocol collections + 测试 fw sessions 级联 + sandbox 产物。
// 在 HK 服务器执行：
//   mongosh "mongodb://127.0.0.1:27017/muzhi_production" --quiet --eval 'var DRY_RUN = true' --file cleanup-u4-production.mongosh.js
// 用户已确认：8 个旧 protocol collections drop、15 个 fw session 全删（级联 events/messages/parts/checkpoints/runs/sandbox 索引）、14 个 sandbox 产物全删。
// 保留：zmzaiagenttasks（sessionId=null，任务定义非 session 数据）、zmzaiframeworkseqs（计数器）、workspaces/workspacefiles/revisions。
const dbc = db.getSiblingDB("muzhi_production");
const DRY = typeof DRY_RUN === "undefined" ? false : DRY_RUN;
const mode = DRY ? "[DRY-RUN]" : "[EXEC]";

const sessionIds = dbc.zmzaiframeworksessions.find({}, { sessionId: 1 }).toArray().map((s) => s.sessionId);
print(mode, "目标 fw session 数:", sessionIds.length);

// A. 8 个旧 protocol collections（代码已删，8/10-8/11 数据，确认无新写入）
const OLD = [
  "zmzaiagenttaskruns",
  "zmzaiagenttaskevents",
  "zmzaiagentchangeproposals",
  "zmzaiagentexecutionproposals",
  "zmzaiagentexecutiongrants",
  "zmzaiagenttoolcalls",
  "zmzaiagentartifactreferences",
  "zmzaiagentsessions",
];
for (const c of OLD) {
  const n = dbc[c].countDocuments();
  if (DRY) {
    print("  [dry] drop", c, "(", n, "docs )");
  } else {
    dbc[c].drop();
    print("  dropped", c, "(", n, "docs )");
  }
}

// B. fw sessions 级联删除（按 sessionId）
const cascade = [
  ["zmzaiframeworksessions", { sessionId: { $in: sessionIds } }],
  ["zmzaiframeworkevents", { sessionId: { $in: sessionIds } }],
  ["zmzaiframeworkmessages", { sessionId: { $in: sessionIds } }],
  ["zmzaiframeworkparts", { sessionId: { $in: sessionIds } }],
  ["zmzaiagentcheckpoints", { sessionId: { $in: sessionIds } }],
  ["zmzaiagentruns", { sessionId: { $in: sessionIds } }],
  // sandbox 产物索引：其 gridFsFileId 全部指向将被 drop 的 sandboxArtifacts 桶（fs 桶为空），
  // 文件删除后索引全部悬空，故全量删除（runId 兼容新旧两种 id 体系）。
  ["zmzaiagentsandboxartifacts", {}],
];
for (const [c, q] of cascade) {
  const n = dbc[c].countDocuments(q);
  if (DRY) {
    print("  [dry] delete", c, "by session:", n);
  } else {
    const r = dbc[c].deleteMany(q);
    print("  deleted", c, ":", r.deletedCount);
  }
}

// C. sandbox 产物（GridFS 桶全删）
if (DRY) {
  print(
    "  [dry] drop sandboxArtifacts.files/chunks:",
    dbc["sandboxArtifacts.files"].countDocuments(),
    "/",
    dbc["sandboxArtifacts.chunks"].countDocuments(),
  );
} else {
  print("  dropped sandboxArtifacts.files:", dbc["sandboxArtifacts.files"].drop());
  print("  dropped sandboxArtifacts.chunks:", dbc["sandboxArtifacts.chunks"].drop());
}

// 验证
print("=== 验证 ===");
if (!DRY) {
  OLD.forEach((c) => print(" ", c, "exists:", dbc.getCollectionNames().includes(c)));
  ["zmzaiframeworksessions", "zmzaiframeworkevents", "zmzaiframeworkmessages", "zmzaiframeworkparts", "zmzaiagentcheckpoints", "zmzaiagentruns", "zmzaiagentsandboxartifacts"].forEach((c) =>
    print(" ", c, "left:", dbc[c].countDocuments()),
  );
  print(" sandboxArtifacts.*:", dbc.getCollectionNames().filter((n) => n.startsWith("sandboxArtifacts")).join(",") || "none");
}
