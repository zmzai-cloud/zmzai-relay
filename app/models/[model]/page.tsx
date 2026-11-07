import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, PageHeader, Terminal } from "@zmzai/theme";
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
  const matches = channels.flatMap((channel) => channel.models.map((model) => ({ channel: channel.channel, model }))).filter((item) => item.model.model === target);
  const found = matches.find((item) => item.model.available) ?? matches[0];
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
      <PageHeader
        className="mt-4"
        icon="sparkle"
        eyebrow="模型详情"
        title={model.model}
        titleClassName="font-mono"
        description="以下为对应渠道每 1K token 的人民币实际单价；自动切换渠道时，最终费用按实际使用的渠道计算。"
        actions={<><Badge variant="outline" size="sm">渠道 {channel}</Badge><Badge variant={model.available ? "success" : "warning"} size="sm">{model.available ? "可路由" : "暂不可用"}</Badge></>}
      />

      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-bg p-4">
            <p className="font-mono text-xs text-muted">{label}</p>
            <p className="mt-1.5 font-mono text-sm font-medium">{value}</p>
          </div>
        ))}
      </div>

      {matches.length > 1 ? <div className="mt-8 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="bg-surface p-3 text-left font-medium">各渠道实际价格 / 1K</caption>
          <thead><tr><th className="p-3">渠道</th><th className="p-3">状态</th><th className="p-3">输入</th><th className="p-3">输出</th><th className="p-3">缓存读</th><th className="p-3">缓存写</th></tr></thead>
          <tbody>{matches.map(({channel: name, model: item}) => <tr key={name} className="border-t border-line"><td className="p-3">{name}</td><td className="p-3">{item.available ? "可路由" : "暂不可用"}</td><td className="p-3">{moneyMicros(item.inputPricePer1kMicros)}</td><td className="p-3">{moneyMicros(item.outputPricePer1kMicros)}</td><td className="p-3">{moneyMicros(item.cacheReadPricePer1kMicros)}</td><td className="p-3">{moneyMicros(item.cacheWritePricePer1kMicros)}</td></tr>)}</tbody>
        </table>
      </div> : null}

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
