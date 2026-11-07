import { describe, it, expect, vi } from "vitest";
const upstream = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/providers/network/safe-upstream-fetch", () => ({ safeUpstreamFetch: upstream.fetch }));
import { probeModel, probeFingerprint } from "@/providers/catalog/model-probe";
const input = { baseUrl: "https://example.org/v1", apiKey: "secret-value", upstreamModel: "test-model", publicModel: "public" };
describe("model probing", () => {
  it.each([[401,"auth"],[403,"auth"],[402,"balance"],[429,"rate_limit"],[503,"upstream"]] as const)("classifies HTTP %i", async (status, category) => {
    upstream.fetch.mockResolvedValueOnce(new Response('secret-value', { status }));
    const result = await probeModel(input); expect(result.ok).toBe(false); expect(result.category).toBe(category); expect(JSON.stringify(result)).not.toContain("secret-value");
  });
  it("distinguishes exhausted quota from ordinary rate limiting", async () => {
    upstream.fetch.mockResolvedValueOnce(new Response('{"error":{"code":"1310","message":"已达到每周/每月使用上限"}}',{status:429}));
    const result=await probeModel(input);expect(result.category).toBe("quota_exhausted");expect(result.ok).toBe(false);
  });
  it("reports success only when the response has choices", async () => {
    upstream.fetch.mockResolvedValueOnce(Response.json({choices:[{message:{role:"assistant",content:"ok"}}]})); expect((await probeModel(input)).ok).toBe(true);
    upstream.fetch.mockResolvedValueOnce(Response.json({})); expect((await probeModel(input)).ok).toBe(false);
    upstream.fetch.mockResolvedValueOnce(Response.json({choices:[null,{}]})); expect((await probeModel(input)).ok).toBe(false);
  });
  it("classifies timeouts", async () => { upstream.fetch.mockRejectedValueOnce(new Error("UPSTREAM_CONNECT_TIMEOUT")); expect((await probeModel(input)).category).toBe("timeout"); });
  it("invalidates fingerprints for changes to address, key, and mappings", () => {
    const original=probeFingerprint(input);
    for (const update of [{baseUrl:"https://other.example"},{apiKey:"new"},{upstreamModel:"new"},{publicModel:"new"}]) expect(probeFingerprint({...input,...update})).not.toBe(original);
    expect(original).not.toContain(input.apiKey);
  });
});
