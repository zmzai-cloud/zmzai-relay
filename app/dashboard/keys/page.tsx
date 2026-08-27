import { redirect } from "next/navigation";
import { RelayShell } from "@/components/relay-shell";
import { getCurrentUser } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ApiKeyModel } from "@/providers/database/mongodb/models/apikey";
import { ModelPriceModel } from "@/providers/database/mongodb/models/model-price";
import { TokenPanel } from "../token-panel";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";
export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard/keys")}`);
  await connectMongo();
  const [keys, models] = await Promise.all([ApiKeyModel.find({ userId: user.id }).sort({ createdAt: -1 }).lean(), ModelPriceModel.find({ enabled: true }).sort({ model: 1 }).lean()]);
  return (
    <RelayShell role="user" userName={user.name} isAdminUser={user.role === "admin"}>
      <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
      <p className="mt-2 text-sm text-ink-2">创建和管理调用凭证，Key 可随时吊销，可为每个 Key 设置模型范围与消费上限。</p>
      <div className="mt-6">
        <TokenPanel
          initialKeys={keys.map((key) => ({ _id: String(key._id), prefix: key.prefix, name: key.name, status: key.status, rateLimitPerMinute: key.rateLimitPerMinute, monthlySpendLimitMicros: key.monthlySpendLimitMicros, monthlySpendUsedMicros: key.monthlySpendUsedMicros, lastUsedAt: key.lastUsedAt?.toISOString() ?? null }))}
          models={models.map((model) => model.model)}
        />
      </div>
    </RelayShell>
  );
}
