import { model, models, Schema, type Model, type Types } from "mongoose";

export interface BalanceAccountRecord {
  userId: Types.ObjectId;
  balanceMicros: number;
  reservedMicros: number;
  welcomeGrantedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<BalanceAccountRecord>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  balanceMicros: { type: Number, required: true, default: 0, min: 0 },
  reservedMicros: { type: Number, required: true, default: 0, min: 0 },
  welcomeGrantedAt: { type: Date, default: null },
}, { strict: "throw", timestamps: true });

export const BalanceAccountModel =
  (models.BalanceAccount as Model<BalanceAccountRecord> | undefined) ?? model<BalanceAccountRecord>("BalanceAccount", accountSchema);

// transfer_out/transfer_in 成对出现：资金池划拨时源账户记 out（负）、目标账户记 in（正）
export const ledgerKinds = ["admin_credit", "admin_debit", "purchase_credit", "welcome_credit", "usage_charge", "refund", "transfer_out", "transfer_in"] as const;
export interface BalanceLedgerRecord {
  userId: Types.ObjectId;
  kind: (typeof ledgerKinds)[number];
  amountMicros: number;
  balanceBeforeMicros: number;
  balanceAfterMicros: number;
  usageId: Types.ObjectId | null;
  operatorUserId: Types.ObjectId | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ledgerSchema = new Schema<BalanceLedgerRecord>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  kind: { type: String, enum: ledgerKinds, required: true },
  amountMicros: { type: Number, required: true },
  balanceBeforeMicros: { type: Number, required: true, min: 0 },
  balanceAfterMicros: { type: Number, required: true, min: 0 },
  usageId: { type: Schema.Types.ObjectId, ref: "Usage", default: null },
  operatorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  note: { type: String, default: null, maxlength: 500 },
}, { strict: "throw", timestamps: true });
ledgerSchema.index({ userId: 1, createdAt: -1 });

export const BalanceLedgerModel =
  (models.BalanceLedger as Model<BalanceLedgerRecord> | undefined) ?? model<BalanceLedgerRecord>("BalanceLedger", ledgerSchema);
