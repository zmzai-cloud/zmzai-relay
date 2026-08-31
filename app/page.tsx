import Link from "next/link";
import { Button, PageHeader, Terminal } from "@zmzai/theme";
import { ModelTable } from "@/components/model-table";
import { PublicShell } from "@/components/public-shell";
import { getPublicChannels } from "@/providers/catalog/public-models";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { getCurrentUser } from "@/providers/auth/session";

export const dynamic = "force-dynamic";
const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";

const steps: Array<[string, string]> = [
  ["登录并创建 API Key", "使用 zmzai 账号登录，在控制台创建一个 API Key，新账号自带 ¥1 体验额度。"],
  ["按 OpenAI 协议发起请求", "兼容 OpenAI Chat Completions 接口，OpenAI SDK、curl 直接替换 baseURL 即可调用。"],
  ["查看用量与账单", "每次调用按 token 实时计费，用量、余额与账本在控制台随时核对。"],
];

export default async function HomePage() {
  const user = await getCurrentUser();
  await connectMongo();
  const channels = await getPublicChannels();
  const totalModels = channels.reduce((sum, ch) => sum + ch.models.length, 0);
  return (
    <PublicShell user={user ? { name: user.name } : null} isAdminUser={user?.role === "admin"}>
      <PageHeader
        variant="hero"
        icon="bolt"
        className="max-w-2xl"
        eyebrow={`${totalModels} 个模型 · ${channels.length} 条上游渠道 · OpenAI 兼容`}
        title="一个入口，调用所有上游模型"
        description="Relay 提供 OpenAI 兼容的统一 API：按模型自动路由到上游渠道，价格公开、按 token 计费、缓存命中享折扣。"
        actions={
          <>
            {user ? (
              <Link href={user.role === "admin" ? "/admin" : "/dashboard"}>
                <Button>进入控制台</Button>
              </Link>
            ) : (
              <Link href={`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard")}`}>
                <Button>登录开始使用</Button>
              </Link>
            )}
            <Link href="/models" className="text-sm text-accent underline underline-offset-4">查看模型与价格</Link>
          </>
        }
      />

      <section className="mt-14">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">可用模型</h2>
          <Link href="/models" className="font-mono text-xs text-muted hover:text-accent">完整目录 →</Link>
        </div>
        <ModelTable channels={channels} />
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">三步接入</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {steps.map(([title, desc], index) => (
            <li key={title} className="rounded-lg border border-line bg-bg p-5">
              <p className="font-mono text-xs text-muted">0{index + 1}</p>
              <p className="mt-2 font-medium">{title}</p>
              <p className="mt-1.5 text-sm leading-6 text-ink-2">{desc}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6">
          <Terminal title="curl — chat completions">
            <span>{`curl https://m.zmzai.cloud/api/v1/chat/completions \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"你好"}]}'`}</span>
          </Terminal>
        </div>
      </section>
    </PublicShell>
  );
}
