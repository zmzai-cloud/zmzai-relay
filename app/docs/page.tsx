import Link from "next/link";
import { PageHeader, Terminal } from "@zmzai/theme";
import { PublicShell } from "@/components/public-shell";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { getCurrentUser } from "@/providers/auth/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "API 文档 · Relay" };

const BASE = "https://m.zmzai.cloud/v1/chat/completions";

export default async function PublicDocsPage() {
  const user = await getCurrentUser();
  await connectMongo();
  return (
    <PublicShell user={user} isAdminUser={user?.role === "admin"}>
      <div className="max-w-3xl">
        <PageHeader
          icon="book"
          eyebrow="接口参考"
          title="API 文档"
          description={
            <>
              Relay 兼容 OpenAI Chat Completions 协议：把 baseURL 指向 <code className="font-mono text-xs">https://m.zmzai.cloud/v1</code>，用 API Key 鉴权即可。zcode、codex 等第三方工具直接使用此地址。模型与价格见 <Link href="/models" className="text-accent underline underline-offset-4">模型列表</Link>。
            </>
          }
        />

        <h2 className="mt-10 text-lg font-semibold">1. 鉴权</h2>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          在控制台创建 API Key 后，通过 <code className="font-mono text-xs">Authorization: Bearer &lt;YOUR_API_KEY&gt;</code> 请求头传入。Key 可随时吊销，每次调用按 token 实时计费。
        </p>

        <h2 className="mt-10 text-lg font-semibold">2. 非流式请求</h2>
        <div className="mt-3">
          <Terminal title="curl — 非流式">
            <span>{`curl ${BASE} \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"你好"}]}'`}</span>
          </Terminal>
        </div>

        <h2 className="mt-10 text-lg font-semibold">3. 流式请求</h2>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          请求体增加 <code className="font-mono text-xs">&quot;stream&quot;: true</code>，服务端返回 SSE 数据流，末尾的 usage 事件携带本次调用的 token 统计。
        </p>
        <div className="mt-3">
          <Terminal title="curl — 流式">
            <span>{`curl -N ${BASE} \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepseek-v4-pro","stream":true,"messages":[{"role":"user","content":"你好"}]}'`}</span>
          </Terminal>
        </div>

        <h2 className="mt-10 text-lg font-semibold">4. 渠道路由</h2>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          默认按模型自动选择上游渠道（失败时自动尝试下一个）。需要精确控制时，在请求体传入 <code className="font-mono text-xs">&quot;channel&quot;: &quot;渠道名&quot;</code>。渠道名见模型列表的渠道列。
        </p>

        <h2 className="mt-10 text-lg font-semibold">5. 推理强度</h2>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          支持 <code className="font-mono text-xs">reasoning_effort</code> 参数（low / medium / high，各模型支持范围见模型详情页）。DeepSeek 的思考相关参数可随请求体透传。
        </p>

        <h2 className="mt-10 text-lg font-semibold">6. 计费</h2>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          按 token 计费：输入、输出分别计价，缓存命中的输入按折扣价结算。每次调用前按最大成本预占额度、结束后按实际用量结算；余额与每笔账单可在控制台「用量与账单」核对。
        </p>
      </div>
    </PublicShell>
  );
}
