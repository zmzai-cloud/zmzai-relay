import { randomBytes, randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/providers/auth/session";
import { getWalletProducts } from "@/providers/billing/wallet-products";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { WalletOrderModel, paymentMethods } from "@/providers/database/mongodb/models/wallet-order";

export const dynamic = "force-dynamic";
const createSchema = z.object({ productId: z.string().min(1).max(80), paymentMethod: z.enum(paymentMethods).default("wechat") });

/** 申请码有效期：用户需在此时间内把码发给管理员核销 */
const CLAIM_KEY_TTL_MS = 5 * 60 * 1000;
/** 去掉易混淆字符（0/O、1/I/L）的码表，方便微信里抄写 */
const CLAIM_KEY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateClaimKey(): string {
  const bytes = randomBytes(7);
  let key = "";
  for (const byte of bytes) key += CLAIM_KEY_ALPHABET[byte % CLAIM_KEY_ALPHABET.length];
  return `R${key}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "需要登录", code: "UNAUTHENTICATED" }, { status: 401 });
  await connectMongo();
  const orders = await WalletOrderModel.find({ userId: user.id }).sort({ createdAt: -1 }).limit(30).lean();
  return NextResponse.json({ orders, products: getWalletProducts() });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "需要登录", code: "UNAUTHENTICATED" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "订单参数不正确", code: "INVALID_BODY" }, { status: 400 });
  const product = getWalletProducts().find((item) => item.id === parsed.data.productId);
  if (!product) return NextResponse.json({ error: "额度商品不存在", code: "PRODUCT_NOT_FOUND" }, { status: 404 });
  await connectMongo();
  // 唯一索引冲突时重试换码（碰撞概率极低）
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const order = await WalletOrderModel.create({
        orderNo: `ZMZ${Date.now().toString(36).toUpperCase()}${randomUUID().slice(0, 6).toUpperCase()}`,
        userId: user.id,
        productId: product.id,
        productName: product.name,
        creditMicros: product.creditMicros,
        paymentAmountFen: product.paymentAmountFen,
        paymentMethod: parsed.data.paymentMethod,
        status: "pending",
        claimKey: generateClaimKey(),
        expiresAt: new Date(Date.now() + CLAIM_KEY_TTL_MS),
      });
      return NextResponse.json({ order: order.toObject() }, { status: 201 });
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
    }
  }
  return NextResponse.json({ error: "申请码生成失败，请重试", code: "CLAIM_KEY_COLLISION" }, { status: 500 });
}
