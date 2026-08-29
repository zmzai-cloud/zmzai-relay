import mongoose, { type ClientSession, type Types } from "mongoose";

import { ApiKeyModel } from "@/providers/database/mongodb/models/apikey";
import { BalanceAccountModel, BalanceLedgerModel } from "@/providers/database/mongodb/models/balance";
import { BalanceReservationModel } from "@/providers/database/mongodb/models/reservation";
import { UsageModel } from "@/providers/database/mongodb/models/usage";
import { currentPeriod } from "./period";
import { ensureWelcomeCredit } from "./onboarding";
import { emitUsageRecorded } from "@/providers/telemetry";

const RESERVATION_MS = 10 * 60 * 1000;

export class BillingError extends Error {
  constructor(readonly code: "INSUFFICIENT_BALANCE" | "TOKEN_SPEND_LIMIT", message: string) {
    super(message);
  }
}

export { currentPeriod } from "./period";

export function chargeMicros(tokens: number, pricePer1kMicros: number): number {
  return Math.ceil((tokens * pricePer1kMicros) / 1000);
}

export function maximumChargeMicros(price: { maxInputTokens: number; maxOutputTokens: number; inputPricePer1kMicros: number; outputPricePer1kMicros: number; cacheWritePricePer1kMicros?: number }): number {
  // Reserve using the most expensive input dimension (regular or cache-write).
  const inputMax = chargeMicros(price.maxInputTokens, price.inputPricePer1kMicros);
  const cacheWriteMax = price.cacheWritePricePer1kMicros ? chargeMicros(price.maxInputTokens, price.cacheWritePricePer1kMicros) : 0;
  return Math.max(inputMax, cacheWriteMax) + chargeMicros(price.maxOutputTokens, price.outputPricePer1kMicros);
}

interface ReserveInput {
  usageId: Types.ObjectId;
  userId: string;
  apiKeyId: string | null;
  amountMicros: number;
}

export async function reserveBalance(input: ReserveInput): Promise<void> {
  await ensureWelcomeCredit(input.userId);
  const dbSession = await mongoose.startSession();
  try {
    await dbSession.withTransaction(async () => {
      const account = await BalanceAccountModel.findOne({ userId: input.userId }).session(dbSession);
      if (!account || account.balanceMicros - account.reservedMicros < input.amountMicros) {
        throw new BillingError("INSUFFICIENT_BALANCE", "余额不足，无法覆盖本次调用的最高费用");
      }

      if (input.apiKeyId) {
        const key = await ApiKeyModel.findById(input.apiKeyId).session(dbSession);
        if (!key) throw new BillingError("TOKEN_SPEND_LIMIT", "Token 不存在或已失效");
        const period = currentPeriod();
        if (key.monthlySpendPeriod !== period) {
          key.monthlySpendPeriod = period;
          key.monthlySpendUsedMicros = 0;
          key.monthlySpendReservedMicros = 0;
        }
        if (key.monthlySpendLimitMicros > 0 && key.monthlySpendUsedMicros + key.monthlySpendReservedMicros + input.amountMicros > key.monthlySpendLimitMicros) {
          throw new BillingError("TOKEN_SPEND_LIMIT", "此 Token 本月消费上限不足");
        }
        key.monthlySpendReservedMicros += input.amountMicros;
        await key.save({ session: dbSession });
      }

      account.reservedMicros += input.amountMicros;
      await account.save({ session: dbSession });
      await BalanceReservationModel.create([{
        userId: input.userId,
        apiKeyId: input.apiKeyId,
        usageId: input.usageId,
        amountMicros: input.amountMicros,
        status: "held",
        expiresAt: new Date(Date.now() + RESERVATION_MS),
      }], { session: dbSession });
    });
  } finally {
    await dbSession.endSession();
  }
}

export async function releaseReservation(usageId: Types.ObjectId): Promise<void> {
  await settleReservation(usageId, null);
}

interface Settlement {
  chargedMicros: number;
  costMicros: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  channelId: Types.ObjectId;
  upstreamModel: string;
  latencyMs: number;
  inputPricePer1kMicros: number;
  outputPricePer1kMicros: number;
  cacheReadPricePer1kMicros: number;
  cacheWritePricePer1kMicros: number;
  inputCostPer1kTokensMicros: number;
  outputCostPer1kTokensMicros: number;
  cacheReadCostPer1kTokensMicros: number;
  cacheWriteCostPer1kTokensMicros: number;
}

export async function settleReservation(usageId: Types.ObjectId, settlement: Settlement | null, context?: { traceId?: string | null }): Promise<void> {
  const dbSession = await mongoose.startSession();
  // 遥测钩子：事务提交成功后异步发 usage.recorded（fire-and-forget，绝不阻塞/影响扣费）。
  let settledUserId: string | null = null;
  try {
    await dbSession.withTransaction(async () => {
      const reservation = await BalanceReservationModel.findOne({ usageId, status: "held" }).session(dbSession);
      if (!reservation) return;
      const account = await BalanceAccountModel.findOne({ userId: reservation.userId }).session(dbSession);
      if (!account) throw new Error("Balance account disappeared during settlement");
      account.reservedMicros -= reservation.amountMicros;

      if (reservation.apiKeyId) {
        const key = await ApiKeyModel.findById(reservation.apiKeyId).session(dbSession);
        if (key) {
          key.monthlySpendReservedMicros = Math.max(0, key.monthlySpendReservedMicros - reservation.amountMicros);
          if (settlement) {
            key.monthlySpendUsedMicros += settlement.chargedMicros;
            key.quotaUsedTokens += settlement.promptTokens + settlement.completionTokens;
            key.lastUsedAt = new Date();
          }
          await key.save({ session: dbSession });
        }
      }

      if (!settlement) {
        reservation.status = "released";
        await reservation.save({ session: dbSession });
        await account.save({ session: dbSession });
        return;
      }
      if (settlement.chargedMicros > reservation.amountMicros || account.balanceMicros < settlement.chargedMicros) {
        throw new Error("Settlement exceeded its reservation");
      }
      const before = account.balanceMicros;
      account.balanceMicros -= settlement.chargedMicros;
      await account.save({ session: dbSession });
      reservation.status = "settled";
      await reservation.save({ session: dbSession });
      await UsageModel.updateOne({ _id: usageId }, { $set: {
        status: "completed", channelId: settlement.channelId, upstreamModel: settlement.upstreamModel,
        promptTokens: settlement.promptTokens, completionTokens: settlement.completionTokens,
        cacheReadTokens: settlement.cacheReadTokens, cacheWriteTokens: settlement.cacheWriteTokens,
        totalTokens: settlement.promptTokens + settlement.completionTokens, costMicros: settlement.costMicros,
        chargedMicros: settlement.chargedMicros, grossProfitMicros: settlement.chargedMicros - settlement.costMicros,
        latencyMs: settlement.latencyMs, inputPricePer1kMicros: settlement.inputPricePer1kMicros,
        outputPricePer1kMicros: settlement.outputPricePer1kMicros,
        cacheReadPricePer1kMicros: settlement.cacheReadPricePer1kMicros,
        cacheWritePricePer1kMicros: settlement.cacheWritePricePer1kMicros,
        inputCostPer1kTokensMicros: settlement.inputCostPer1kTokensMicros,
        outputCostPer1kTokensMicros: settlement.outputCostPer1kTokensMicros,
        cacheReadCostPer1kTokensMicros: settlement.cacheReadCostPer1kTokensMicros,
        cacheWriteCostPer1kTokensMicros: settlement.cacheWriteCostPer1kTokensMicros,
      }}).session(dbSession);
      await BalanceLedgerModel.create([{
        userId: reservation.userId, kind: "usage_charge", amountMicros: -settlement.chargedMicros,
        balanceBeforeMicros: before, balanceAfterMicros: account.balanceMicros, usageId,
        operatorUserId: null, note: null,
      }], { session: dbSession });
      settledUserId = reservation.userId;
    });
    if (settledUserId && settlement) {
      emitUsageRecorded({
        userId: settledUserId,
        product: "relay",
        metric: "tokens",
        amount: settlement.promptTokens + settlement.completionTokens,
        costMicros: settlement.chargedMicros,
        traceId: context?.traceId ?? undefined,
        meta: {
          usageId: String(usageId),
          upstreamModel: settlement.upstreamModel,
          channelId: String(settlement.channelId),
          promptTokens: settlement.promptTokens,
          completionTokens: settlement.completionTokens,
          latencyMs: settlement.latencyMs,
          channelCostMicros: settlement.costMicros,
        },
      });
    }
  } finally {
    await dbSession.endSession();
  }
}
