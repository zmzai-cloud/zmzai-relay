import { describe, expect, it, vi } from "vitest";

const prices = [
  { model: "legacy", enabled: true },
  { model: "hidden", enabled: true, publicVisible: false },
  { model: "disabled", enabled: false, publicVisible: true },
];
const channels = [{ _id:"c", baseUrl:"https://example.com", apiKey:"test-key", name: "test", priority: 1, models: prices.map(({ model }) => ({ public: model, upstream: model })) }];
vi.mock("@/providers/database/mongodb/models/model-price", () => ({
  ModelPriceModel: { find: (query: Record<string, unknown>) => {
    const rows = prices.filter(p => p.enabled && (!("publicVisible" in query) || p.publicVisible !== false));
    return { sort: () => ({ lean: async () => rows }), lean: async () => rows };
  } },
}));
vi.mock("@/providers/database/mongodb/models/channel", () => ({
  ChannelModel: { find: () => ({ sort: () => ({ lean: async () => channels }), select: () => ({ sort: () => ({lean: async () => channels}) }) }) },
}));
vi.mock("@/providers/database/mongodb/models/model-health",()=>({ModelHealthModel:{find:()=>({select:()=>({lean:async()=>[]})})}}));
import { getPublicModels, getPublicChannels, getInternalModelSelectorData } from "@/providers/catalog/public-models";

describe("model visibility", () => {
  it("lists legacy records, but hides explicitly hidden and disabled models", async () => {
    expect((await getPublicModels()).map(m => m.model)).toEqual(["legacy"]);
    expect((await getPublicChannels())[0].models.map(m => m.model)).toEqual(["legacy"]);
    expect((await getInternalModelSelectorData()).channels[0].models.map(m => m.id)).toEqual(["legacy"]);
  });
});
