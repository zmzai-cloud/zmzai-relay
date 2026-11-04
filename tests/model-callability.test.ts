import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/providers/auth/session", () => ({ getCurrentUser: async () => ({ id: "u", name: "User" }) }));
vi.mock("@/providers/database/mongodb/connection", () => ({ connectMongo: async () => undefined }));
vi.mock("@/providers/database/mongodb/models/model-price", () => ({
  reasoningEfforts: ["low"],
  ModelPriceModel: { findOne: () => ({ lean: async () => ({ model: "hidden", enabled: state.enabled, publicVisible: false, allowedReasoningEfforts: ["low"], maxOutputTokens: 100 }) }) },
}));
vi.mock("@/providers/database/mongodb/models/usage", () => ({ UsageModel: { findOne: () => ({ lean: async () => null }), create: async () => ({ _id: "usage" }), updateOne: async () => ({}) } }));
vi.mock("@/providers/database/mongodb/models/channel", () => ({ ChannelModel: { find: () => ({ select: () => ({ sort: () => ({ lean: async () => [] }) }) }) }, resolveChannelCosts: () => null }));
import { POST } from "@/app/api/v1/chat/completions/route";
const request = () => new NextRequest("http://localhost/api/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "hidden", messages: [{role: "user", content: "hi"}] }) });
describe("model callability", () => {
 it("allows hidden enabled models to reach routing", async () => { state.enabled = true; const response = await POST(request()); expect(response.status).toBe(503); expect((await response.json()).code).toBe("NO_CHANNEL"); });
 it("rejects disabled models before routing", async () => { state.enabled = false; const response = await POST(request()); expect(response.status).toBe(400); expect((await response.json()).code).toBe("MODEL_NOT_PRICED"); });
});
