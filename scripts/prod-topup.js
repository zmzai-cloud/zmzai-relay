// 查测试 key 余额，不足 ¥5 则加款 ¥10（admin_credit）
const key = db.apikeys.findOne({ prefix: "zrk_cCpgoowS" });
if (!key) { print("key not found"); quit(1); }
print("key: " + key.name + " user=" + key.userId);
let bal = db.balanceaccounts.findOne({ userId: key.userId });
if (!bal) { print("no balance account, create one"); const r = db.balanceaccounts.insertOne({ userId: key.userId, balanceMicros: 10_000_000, updatedAt: new Date() }); bal = db.balanceaccounts.findOne({ _id: r.insertedId }); }
print("balance before: " + bal.balanceMicros + " micros = ¥" + bal.balanceMicros / 1e6);
if (bal.balanceMicros < 5_000_000) {
  db.balanceaccounts.updateOne({ _id: bal._id }, { $inc: { balanceMicros: 10_000_000 }, $set: { updatedAt: new Date() } });
  db.balanceledgers.insertOne({ userId: key.userId, kind: "admin_credit", amountMicros: 10_000_000, balanceAfterMicros: bal.balanceMicros + 10_000_000, note: "P0 定价验证测试加款", createdAt: new Date() });
  print("topup +10,000,000 micros (¥10), balance now ¥" + (bal.balanceMicros + 10_000_000) / 1e6);
} else {
  print("balance sufficient, no topup");
}
