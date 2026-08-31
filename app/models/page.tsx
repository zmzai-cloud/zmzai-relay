import { PageHeader } from "@zmzai/theme";
import { ModelTable } from "@/components/model-table";
import { PublicShell } from "@/components/public-shell";
import { getPublicChannels } from "@/providers/catalog/public-models";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { getCurrentUser } from "@/providers/auth/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "模型广场 · Relay" };

export default async function ModelsPage() {
  const user = await getCurrentUser();
  await connectMongo();
  const channels = await getPublicChannels();
  return (
    <PublicShell user={user} isAdminUser={user?.role === "admin"}>
      <PageHeader
        icon="grid"
        eyebrow="公开目录"
        title="模型广场"
        description={
          <>
            价格为每 1K token 的人民币单价，缓存读取享受折扣价。调用时无需指定渠道，系统按优先级自动路由；如需精确控制，可在请求体传入 <code className="font-mono text-xs">channel</code> 参数。
          </>
        }
      />
      <div className="mt-8">
        <ModelTable channels={channels} />
      </div>
    </PublicShell>
  );
}
