// 本地 dev 种子：把 deepseek-chat 注册进 relay 开放目录（ModelPrice）+ 上游渠道（Channel）。
// 用法：node scripts/seed-local-dev.mjs
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import mongoose from "mongoose";

const root = path.resolve(import.meta.dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}
loadEnvFile(path.join(root, ".env.local"));

const MONGODB_URI = process.env.MONGODB_URI;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!MONGODB_URI) throw new Error("MONGODB_URI missing in .env.local");
if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing in .env.local");

function cnyYuanToMicros(value) {
  return Math.round((value * 100 * 1_000_000) / 800);
}

const reasoningEfforts = ["low", "medium", "high", "xhigh", "max"];

const modelPriceSchema = new mongoose.Schema({
  model: { type: String, required: true, trim: true, unique: true, maxlength: 120 },
  multiplier: { type: Number, required: true, default: 1, min: 0.01, max: 100 },
  inputPricePer1kMicros: { type: Number, required: true, min: 0 },
  outputPricePer1kMicros: { type: Number, required: true, min: 0 },
  cacheReadPricePer1kMicros: { type: Number, required: true, default: 0, min: 0 },
  cacheWritePricePer1kMicros: { type: Number, required: true, default: 0, min: 0 },
  maxInputTokens: { type: Number, required: true, min: 1, max: 2_000_000 },
  maxOutputTokens: { type: Number, required: true, min: 1, max: 500_000 },
  allowedReasoningEfforts: { type: [String], enum: reasoningEfforts, required: true, default: () => [...reasoningEfforts] },
  featured: { type: Boolean, required: true, default: false },
  featuredDescription: { type: String, required: true, default: "", maxlength: 200 },
  enabled: { type: Boolean, required: true, default: true },
}, { strict: "throw", timestamps: true });

const modelMappingSchema = new mongoose.Schema({
  public: { type: String, required: true, trim: true },
  upstream: { type: String, required: true, trim: true },
}, { _id: false, strict: "throw" });

const channelSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  baseUrl: { type: String, required: true, trim: true, maxlength: 500 },
  apiKey: { type: String, required: true, select: false },
  protocol: { type: String, enum: ["openai-compat"], required: true, default: "openai-compat" },
  models: { type: [modelMappingSchema], required: true, default: [] },
  priority: { type: Number, required: true, default: 10 },
  inputCostPer1kTokensMicros: { type: Number, default: null, min: 0 },
  outputCostPer1kTokensMicros: { type: Number, default: null, min: 0 },
  enabled: { type: Boolean, required: true, default: true },
  timeoutMs: { type: Number, required: true, default: 60000, min: 1000 },
}, { strict: "throw", timestamps: true });

const ModelPrice = mongoose.models.ModelPrice ?? mongoose.model("ModelPrice", modelPriceSchema);
const Channel = mongoose.models.Channel ?? mongoose.model("Channel", channelSchema);

await mongoose.connect(MONGODB_URI, { bufferCommands: false, serverSelectionTimeoutMS: 10_000 });

await ModelPrice.findOneAndUpdate(
  { model: "deepseek-chat" },
  {
    $set: {
      model: "deepseek-chat",
      multiplier: 1,
      inputPricePer1kMicros: cnyYuanToMicros(0.001),
      outputPricePer1kMicros: cnyYuanToMicros(0.002),
      cacheReadPricePer1kMicros: 0,
      cacheWritePricePer1kMicros: 0,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 64_000,
      allowedReasoningEfforts: [...reasoningEfforts],
      featured: false,
      featuredDescription: "",
      enabled: true,
    },
  },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);

await Channel.findOneAndUpdate(
  { name: "deepseek-official-dev" },
  {
    $set: {
      name: "deepseek-official-dev",
      baseUrl: "https://api.deepseek.com",
      apiKey: DEEPSEEK_API_KEY,
      protocol: "openai-compat",
      models: [{ public: "deepseek-chat", upstream: "deepseek-chat" }],
      priority: 10,
      inputCostPer1kTokensMicros: cnyYuanToMicros(0.001),
      outputCostPer1kTokensMicros: cnyYuanToMicros(0.002),
      enabled: true,
      timeoutMs: 120_000,
    },
  },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);

console.log("seeded deepseek-chat into ModelPrice + Channel deepseek-official-dev");
await mongoose.disconnect();
