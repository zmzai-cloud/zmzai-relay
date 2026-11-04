export type ModelPrice = { inputPricePer1kMicros: number; outputPricePer1kMicros: number; cacheReadPricePer1kMicros: number; cacheWritePricePer1kMicros: number };
type ModelCosts = { inputCostPer1kTokensMicros: number | null; outputCostPer1kTokensMicros: number | null; cacheReadCostPer1kTokensMicros: number | null; cacheWriteCostPer1kTokensMicros: number | null };
export function perMillionToMicrosPerThousand(value: number): number {
  const result = value * 1000;
  if (!Number.isFinite(result) || value < 0 || !Number.isSafeInteger(result)) throw new Error("价格精度必须为 0.001 元/百万 token");
  return result;
}
export function effectivePrice(price: ModelPrice, multiplier: number): ModelPrice {
  return { inputPricePer1kMicros: Math.round(price.inputPricePer1kMicros * multiplier), outputPricePer1kMicros: Math.round(price.outputPricePer1kMicros * multiplier), cacheReadPricePer1kMicros: Math.round(price.cacheReadPricePer1kMicros * multiplier), cacheWritePricePer1kMicros: Math.round(price.cacheWritePricePer1kMicros * multiplier) };
}
export function effectiveCachePrices(price: Pick<ModelPrice,"inputPricePer1kMicros" | "cacheReadPricePer1kMicros" | "cacheWritePricePer1kMicros">): {cacheRead:number;cacheWrite:number} {
  return {cacheRead:price.cacheReadPricePer1kMicros || price.inputPricePer1kMicros, cacheWrite:price.cacheWritePricePer1kMicros || price.inputPricePer1kMicros};
}
export function previewPrice(input: { price: ModelPrice; multiplier: number; cost: ModelCosts }) {
  const prices=effectivePrice(input.price,input.multiplier), {cacheRead,cacheWrite}=effectiveCachePrices(prices);
  const margin=(sale:number,cost:number|null)=>cost===null || sale===0 ? null : (sale-cost)/sale;
  return {prices,cacheRead,cacheWrite,margins:{input:margin(prices.inputPricePer1kMicros,input.cost.inputCostPer1kTokensMicros),output:margin(prices.outputPricePer1kMicros,input.cost.outputCostPer1kTokensMicros),cacheRead:margin(cacheRead,input.cost.cacheReadCostPer1kTokensMicros),cacheWrite:margin(cacheWrite,input.cost.cacheWriteCostPer1kTokensMicros)}};
}
