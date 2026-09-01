// 生产变更：① admin 资金池补足至 ¥500 ② mimo 渠道开启（幂等，可重复执行）
// 换算：1,000,000 micros = ¥8.00（providers/billing/currency.ts）

const ADMIN_USER_ID = ObjectId("6a72e02e7b602a38783b1136");
const TARGET_MICROS = 62500000; // ¥500.00
const NOTE_CREDIT = "admin 资金池补足至 ¥500，用于向其他账户划拨额度";
const NOTE_CHANNEL = "开启 mimo 渠道（上游连通性已验证）；mimo-v2.5 / mimo-v2.5-pro 一并可用";
const yuan = (m) => "¥" + ((m * 8) / 1e6).toFixed(4) + " (" + m + " micros)";
const now = () => new Date();

print("########## 1. ADMIN 额度补足 ##########");
let acct = db.balanceaccounts.findOne({ userId: ADMIN_USER_ID });
if (!acct) {
  print("balance account missing — creating");
  const r = db.balanceaccounts.insertOne({
    userId: ADMIN_USER_ID, balanceMicros: 0, reservedMicros: 0, welcomeGrantedAt: null, createdAt: now(), updatedAt: now(),
  });
  acct = db.balanceaccounts.findOne({ _id: r.insertedId });
}
const beforeMicros = acct.balanceMicros;
const reservedMicros = acct.reservedMicros || 0;
const delta = TARGET_MICROS - beforeMicros;
print("before: " + yuan(beforeMicros) + " reserved=" + yuan(reservedMicros));
print("target: " + yuan(TARGET_MICROS));
print("delta : " + yuan(Math.abs(delta)) + (delta >= 0 ? " (充值)" : " (扣减)"));

if (delta === 0) {
  print(">> 余额已等于目标值，跳过充值");
} else {
  db.balanceaccounts.updateOne({ userId: ADMIN_USER_ID }, { $inc: { balanceMicros: delta }, $set: { updatedAt: now() } });
  db.balanceledgers.insertOne({
    userId: ADMIN_USER_ID,
    kind: delta > 0 ? "admin_credit" : "admin_debit",
    amountMicros: delta,
    balanceBeforeMicros: beforeMicros,
    balanceAfterMicros: TARGET_MICROS,
    usageId: null,
    operatorUserId: ADMIN_USER_ID,
    note: NOTE_CREDIT,
    createdAt: now(),
    updatedAt: now(),
  });
  db.adminaudits.insertOne({
    operatorUserId: ADMIN_USER_ID,
    resourceType: "balance",
    resourceId: String(ADMIN_USER_ID),
    before: { balanceMicros: beforeMicros },
    after: { balanceMicros: TARGET_MICROS, amountMicros: delta },
    reason: NOTE_CREDIT,
    createdAt: now(),
    updatedAt: now(),
  });
  print(">> 已写入 ledger + admin_audit");
}

print("");
print("########## 2. MIMO 渠道开启 ##########");
const ch = db.channels.findOne({ name: "mimo" });
if (!ch) { print("!! mimo channel not found — 跳过"); }
else {
  print("channel _id=" + ch._id + " enabled=" + ch.enabled + " baseUrl=" + ch.baseUrl);
  if (ch.enabled === true) {
    print(">> 渠道已是 enabled=true，跳过");
  } else {
    db.channels.updateOne({ _id: ch._id }, { $set: { enabled: true, cooldownUntil: null, updatedAt: now() } });
    db.adminaudits.insertOne({
      operatorUserId: ADMIN_USER_ID,
      resourceType: "channel",
      resourceId: String(ch._id),
      before: { enabled: false },
      after: { enabled: true, cooldownUntil: null },
      reason: NOTE_CHANNEL,
      createdAt: now(),
      updatedAt: now(),
    });
    print(">> 已开启并写入 admin_audit");
  }
}

print("");
print("########## 3. 变更后校验 ##########");
const afterAcct = db.balanceaccounts.findOne({ userId: ADMIN_USER_ID });
print("admin balance: " + yuan(afterAcct.balanceMicros) + " | available=" + yuan(Math.max(0, afterAcct.balanceMicros - (afterAcct.reservedMicros || 0))));

const priceRows = db.modelprices.find({ model: /^mimo/i }).toArray();
const liveChannels = db.channels.find({ enabled: true, $or: [{ cooldownUntil: null }, { cooldownUntil: { $lte: now() } }] }).toArray();
priceRows.forEach((p) => {
  const mapped = liveChannels.filter((c) => (c.models || []).some((m) => m.public === p.model));
  print(p.model + ": priceEnabled=" + p.enabled + " liveChannels=[" + mapped.map((c) => c.name).join(",") + "] routable=" + (p.enabled && mapped.length > 0));
});

print("");
print("########## 4. 最近审计 ##########");
print(JSON.stringify(db.adminaudits.find({}).sort({ createdAt: -1 }).limit(3).toArray(), null, 1));
