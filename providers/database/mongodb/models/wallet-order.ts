import { model, models, Schema, type HydratedDocument, type Model, type Types } from "mongoose";

export const walletOrderStatuses = ["pending", "submitted", "paid", "completed", "rejected", "expired", "refunding", "refunded"] as const;
export type WalletOrderStatus = (typeof walletOrderStatuses)[number];
export const paymentMethods = ["wechat", "alipay"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export interface WalletOrderRecord {
  orderNo: string;
  userId: Types.ObjectId;
  productId: string;
  productName: string;
  creditMicros: number;
  paymentAmountFen: number;
  paymentMethod: PaymentMethod;
  status: WalletOrderStatus;
  expiresAt: Date;
  /** 申请码：用户发给管理员的凭据，管理员凭码在后台定位订单核销 */
  claimKey: string | null;
  payerName: string | null;
  screenshotUrl: string | null;
  paymentNote: string | null;
  submittedAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: Types.ObjectId | null;
  reviewNote: string | null;
  fulfillmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<WalletOrderRecord>({
  orderNo: { type: String, required: true, trim: true, unique: true, maxlength: 40 },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  productId: { type: String, required: true, trim: true, maxlength: 80 },
  productName: { type: String, required: true, trim: true, maxlength: 120 },
  creditMicros: { type: Number, required: true, min: 1 },
  paymentAmountFen: { type: Number, required: true, min: 1 },
  paymentMethod: { type: String, enum: paymentMethods, required: true },
  status: { type: String, enum: walletOrderStatuses, required: true, default: "pending", index: true },
  expiresAt: { type: Date, required: true, index: true },
  claimKey: { type: String, default: null, maxlength: 16 },
  payerName: { type: String, default: null, maxlength: 100 },
  screenshotUrl: { type: String, default: null, maxlength: 2000 },
  paymentNote: { type: String, default: null, maxlength: 500 },
  submittedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  reviewNote: { type: String, default: null, maxlength: 500 },
  fulfillmentId: { type: String, default: null, maxlength: 120 },
}, { strict: "throw", timestamps: true });

schema.index({ userId: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: -1 });
// 申请码唯一；历史订单为 null 不受 sparse 索引约束
schema.index({ claimKey: 1 }, { unique: true, sparse: true });

export const WalletOrderModel =
  (models.WalletOrder as Model<WalletOrderRecord> | undefined) ?? model<WalletOrderRecord>("WalletOrder", schema);
export type WalletOrderDocument = HydratedDocument<WalletOrderRecord>;
