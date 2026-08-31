import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Terminal } from "@zmzai/theme";
import { PublicShell } from "@/components/public-shell";
import { getPublicChannels, moneyMicros } from "@/providers/catalog/public-models";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { getCurrentUser } from "@/providers/auth/session";

export const dynamic = "force-dynamic";

export default async function ModelDetailPage({ params }: { params: Promise<{ model: string }> }) {
  const user = await getCurrentUser();
  await connectMongo();
  const { model: slug } = await params;
  const target = decodeURIComponent(slug);
  const channels = await getPublicChannels();
  const found = channels.flatMap((channel) => channel.models.map((model) => ({ channel: channel.channel, model }))).find((item) => item.model.model === target);
  if (!found) notFound();
  const { model, channel } = found;
  const example = `curl -N https://m.zmzai.cloud/api/v1/chat/completions \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model.model}","stream":true,"messages":[{"role":"user","content":"你好"}]}'`;
  const stats: Array<[string, string]> = [
    ["输入 / 1K", moneyMicros(model.inputPricePer1kMicros)],
    ["输出 / 1K", moneyMicros(model.outputPricePer1kMicros)],
    ["缓存读 / 1K", model.cacheReadPricePer1kMicros > 0 ? moneyMicros(model.cacheReadPricePer1kMicros) : "按输入价"],
    ["缓存写 / 1K", model.cacheWritePricePer1kMicros > 0 ? moneyMicros(model.cacheWritePricePer1kMicros) : "按输入价"],
    ["上下文", `${model.maxInputTokens.toLocaleString()} tokens`],
    ["最大输出", `${model.maxOutputTokens.toLocaleString()} tokens`],
  ];
  return (
    <PublicShell user={user} isAdminUser={user?.role === "admin"}>
      <Link href="/models" className="font-mono text-xs text-muted hover:text-accent">← 返回模型列表</Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-3xl font-semibold tracking-tight">{model.model}</h1>
        <Badge variant="outline" size="sm">渠道 {channel}</Badge>
      </div>
      <p className="mt-2 text-sm text-ink-2">价格为每 1K token 的人民币单价；缓存未单独配置价格时按输入价计费。</p>

      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-bg p-4">
            <p className="font-mono text-xs text-muted">{label}</p>
            <p className="mt-1.5 font-mono text-sm font-medium">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <p className="font-mono text-xs text-muted">推理强度 reasoning_effort</p>
        <p className="mt-1.5 text-sm">{model.allowedReasoningEfforts.join(" · ")}</p>
      </div>

      <div className="mt-8 max-w-3xl">
        <p className="mb-3 text-sm font-medium">流式调用示例</p>
        <Terminal title={`curl — ${model.model}`}>
          <span>{example}</span>
        </Terminal>
      </div>

      <p className="mt-8 text-sm text-ink-2">
        完整参数说明见 <Link href="/docs" className="text-accent underline underline-offset-4">API 文档</Link>。
      </p>
    </PublicShell>
  );
}
