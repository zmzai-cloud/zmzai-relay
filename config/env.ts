import { z } from "zod";

function optionalEnvString() {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** 与 muzhi 同 Atlas、同 database，才能读它的 Session/User 表 */
  MONGODB_URI: z.string().min(1),
  /** 必须与 muzhi 一致——hash session token 用 ${AUTH_SECRET}:${token} */
  AUTH_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default("muzhi_session"),
  /** 父域 Cookie，退出时必须以相同作用域清除。 */
  SESSION_COOKIE_DOMAIN: optionalEnvString(),
  /** Relay 管理端额外要求 role=admin **/
  RELAY_DEFAULT_UPSTREAM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .default(60000),
  RELAY_INTERNAL_CRON_SECRET: optionalEnvString(),
  RELAY_SANDBOX_SERVICE_SECRET_CURRENT: optionalEnvString(),
  RELAY_SANDBOX_SERVICE_SECRET_PREVIOUS: optionalEnvString(),
  RELAY_AGENT_SERVICE_SECRET_CURRENT: optionalEnvString(),
  RELAY_AGENT_SERVICE_SECRET_PREVIOUS: optionalEnvString(),
  /** Agent 内部调用走本机 Relay，避免经公网域名回环。 */
  RELAY_INTERNAL_ORIGIN: z.string().url().default("http://127.0.0.1:3002"),
  /** 本地工具桥接端点（zmzai-bridge，b.zmzai.cloud 侧）。Agent 需要用户本机能力时经此下发。 */
  RELAY_BRIDGE_URL: z.string().url().default("http://127.0.0.1:8787"),
  /** 调用桥接内部 API 的 Token；未设置时回退 bridge 仓库的 dev 默认值。生产必须设置。 */
  RELAY_BRIDGE_TOKEN: optionalEnvString(),
  /** 遥测：usage 事件推送到 zmzai-billing /api/v1/ingest。未配置时静默跳过（不阻塞计费主流程）。 */
  BILLING_INGEST_URL: optionalEnvString(),
  BILLING_INGEST_KEY: optionalEnvString(),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= envSchema.parse(process.env);
  return cachedEnv;
}

export function requireAuthSecret(): string {
  const secret = getServerEnv().AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET 未设置，无法校验 muzhi session");
  }
  return secret;
}

export function requireSandboxServiceSecret(): string {
  const secret = getServerEnv().RELAY_SANDBOX_SERVICE_SECRET_CURRENT;
  if (!secret) throw new Error("RELAY_SANDBOX_SERVICE_SECRET_CURRENT 未设置");
  return secret;
}
