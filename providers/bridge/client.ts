import { getServerEnv } from "@/config/env";
import { BridgeClientSdk } from "./bridge-sdk";

let cached: BridgeClientSdk | undefined;

/**
 * 桥接客户端单例。指向 zmzai-bridge（b.zmzai.cloud 侧）。
 * 生产环境必须设置 RELAY_BRIDGE_URL / RELAY_BRIDGE_TOKEN；
 * 未配置时回退到本地联调默认值（bridge 仓库 dev 默认 token）。
 */
export function getBridgeClient(): BridgeClientSdk {
  cached ??= new BridgeClientSdk(
    getServerEnv().RELAY_BRIDGE_URL,
    getServerEnv().RELAY_BRIDGE_TOKEN || "dev-internal-token-change-me",
  );
  return cached;
}
