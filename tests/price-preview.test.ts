import { expect, it } from "vitest";
import { perMillionToMicrosPerThousand, previewPrice } from "@/providers/catalog/price-preview";
it("converts yuan per million precisely", () => { expect(perMillionToMicrosPerThousand(1)).toBe(1000); expect(perMillionToMicrosPerThousand(1.001)).toBe(1001); expect(() => perMillionToMicrosPerThousand(0.0001)).toThrow(); });
it("uses billing rounding and cache fallback and does not invent unknown margins", () => {
 const p=previewPrice({price:{inputPricePer1kMicros:101,outputPricePer1kMicros:0,cacheReadPricePer1kMicros:0,cacheWritePricePer1kMicros:0},multiplier:0.5,cost:{inputCostPer1kTokensMicros:null,outputCostPer1kTokensMicros:1,cacheReadCostPer1kTokensMicros:null,cacheWriteCostPer1kTokensMicros:null}});
 expect(p.prices.inputPricePer1kMicros).toBe(51); expect(p.cacheRead).toBe(51); expect(p.margins.input).toBeNull(); expect(p.margins.output).toBeNull();
});
