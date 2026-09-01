// 生产变更：从 admin 资金池划拨 ¥20 给 ZhangXiao3（GitHub 登录账号）
// 换算：1,000,000 micros = ¥8.00 → ¥20 = 2,500,000 micros
// 幂等：按 MARKER 查 balanceledgers，已划过则跳过

const ADMIN_USER_ID = ObjectId("6a72e02e7b602a38783b1136"); // 牧之 mifindxuan@gmail.com（资金池）
const TARGET_USER_ID = ObjectId("6a967ec207496256daa8ac88"); // ZhangXiao3 464007239@qq.com
const AMOUNT_MICROS = 2500000; // ¥20.00
const MARKER = "grant-20y-zhangxiao3-20260901";
const REASON = "划拨 ¥20 体验额度给 ZhangXiao3（GitHub 登录账号）";

const yuan = (m) => "¥" + ((m * 8) / 1e6).toFixed(4) + " (" + m + " micros)";
const now = () => new Date();

print("########## 0. 前置校验 ##########");
const targetUser = db.users.findOne({ _id: TARGET_USER_ID });
if (!targetUser) { print("!! 目标用户不存在，中止"); quit(1); }
const gh = db.accounts.findOne({ userId: TARGET_USER_ID, provider: "github" });
print("target : " + targetUser.name + " <" + targetUser.email + "> role=" + targetUser.role + " status=" + targetUser.status);
print("github : " + (gh ? gh.username : "(未绑定)"));

if (db.balanceledgers.findOne({ userId: TARGET_USER_ID, note: new RegExp(MARKER) })) {
  print(">> 该笔划拨已存在（幂等），跳过");
  quit(0);
}

const ensureAccount = (userId) => {
  let a = db.balanceaccounts.findOne({ userId });
  if (!a) {
    const r = db.balanceaccounts.insertOne({
      userId, balanceMicros: 0, reservedMicros: 0, welcomeGrantedAt: null, createdAt: now(), updatedAt: now(),
    });
    a = db.balanceaccounts.findOne({ _id: r.insertedId });
    print("   (新建余额账户 " + userId + ")");
  }
  return a;
};

const src = ensureAccount(ADMIN_USER_ID);
const dst = ensureAccount(TARGET_USER_ID);

const srcBefore = src.balanceMicros;
const srcReserved = src.reservedMicros || 0;
const srcAvailable = srcBefore - srcReserved;
const dstBefore = dst.balanceMicros;

print("");
print("########## 1. 划拨前 ##########");
print("资金池 : " + yuan(srcBefore) + " 可用=" + yuan(Math.max(0, srcAvailable)));
print("目标户 : " + yuan(dstBefore));
print("划拨额 : " + yuan(AMOUNT_MICROS));

if (AMOUNT_MICROS > srcAvailable) {
  print("!! 资金池可用余额不足，中止");
  quit(1);
}

const srcAfter = srcBefore - AMOUNT_MICROS;
const dstAfter = dstBefore + AMOUNT_MICROS;
if (dstAfter < (dst.reservedMicros || 0)) {
  print("!! 目标账户余额将低于已预留金额，中止");
  quit(1);
}

print("");
print("########## 2. 执行划拨 ##########");
db.balanceaccounts.updateOne({ userId: ADMIN_USER_ID }, { $inc: { balanceMicros: -AMOUNT_MICROS }, $set: { updatedAt: now() } });
db.balanceaccounts.updateOne({ userId: TARGET_USER_ID }, { $inc: { balanceMicros: AMOUNT_MICROS }, $set: { updatedAt: now() } });

db.balanceledgers.insertOne({
  userId: ADMIN_USER_ID,
  kind: "transfer_out",
  amountMicros: -AMOUNT_MICROS,
  balanceBeforeMicros: srcBefore,
  balanceAfterMicros: srcAfter,
  usageId: null,
  operatorUserId: ADMIN_USER_ID,
  note: `划拨给 ${targetUser.email}｜${REASON}`,
  createdAt: now(),
  updatedAt: now(),
});
db.balanceledgers.insertOne({
  userId: TARGET_USER_ID,
  kind: "transfer_in",
  amountMicros: AMOUNT_MICROS,
  balanceBeforeMicros: dstBefore,
  balanceAfterMicros: dstAfter,
  usageId: null,
  operatorUserId: ADMIN_USER_ID,
  note: `来自资金池划拨（操作者 mifindxuan@gmail.com）｜${REASON}｜${MARKER}`,
  createdAt: now(),
  updatedAt: now(),
});
db.adminaudits.insertOne({
  operatorUserId: ADMIN_USER_ID,
  resourceType: "balance_transfer",
  resourceId: String(TARGET_USER_ID),
  before: { balanceMicros: dstBefore, sourceBalanceMicros: srcBefore },
  after: { balanceMicros: dstAfter, amountMicros: AMOUNT_MICROS, sourceBalanceMicros: srcAfter },
  reason: `资金池划拨｜${REASON}`,
  createdAt: now(),
  updatedAt: now(),
});
print(">> 已写入双向账本 + admin_audit");

print("");
print("########## 3. 变更后校验 ##########");
const srcCheck = db.balanceaccounts.findOne({ userId: ADMIN_USER_ID });
const dstCheck = db.balanceaccounts.findOne({ userId: TARGET_USER_ID });
print("资金池 : " + yuan(srcCheck.balanceMicros) + " 可用=" + yuan(Math.max(0, srcCheck.balanceMicros - (srcCheck.reservedMicros || 0))));
print("目标户 : " + yuan(dstCheck.balanceMicros));
print("");
print("--- 目标账户最近 3 条账本 ---");
db.balanceledgers.find({ userId: TARGET_USER_ID }).sort({ createdAt: -1 }).limit(3).forEach((l) => {
  print("  " + l.kind + " " + yuan(l.amountMicros) + " | " + l.createdAt.toISOString().slice(0, 19) + " | " + l.note);
});
