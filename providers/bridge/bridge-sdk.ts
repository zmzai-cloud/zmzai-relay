/**
 * Bridge SDK —— vendored from zmzai-bridge/sdk/bridge-sdk.ts
 *
 * 自包含轻量客户端（仅用 fetch，无额外依赖）。Relay 用它把 Agent 下发的
 * 「用户本机工具请求」转发到 zmzai-bridge（b.zmzai.cloud 侧）。
 *
 * 执行边界：zmzai-sandbox 的代码/命令在云端容器内执行，不经本 SDK；
 * 本 SDK 只服务「用户本机」能力（fs.read/fs.write/shell.exec/notify）。
 *
 * 使用：
 *   const bridge = getBridgeClient();
 *   const res = await bridge.dispatchToUser(userId, "fs.read", { path: "~/notes.txt" });
 *
 * 注意：即使云端成功下发，客户端本地仍可能弹出用户审批（fs.write / shell.exec 必审），
 * 因此 dispatch 可能耗时较长 —— 调用方应设合理的客户端超时（HTTP 侧由桥接的
 * DISPATCH_TIMEOUT_MS 控制，这里默认 120s）。
 */

export const LocalToolName = [
  "fs.read",
  "fs.write",
  "shell.exec",
  "notify",
] as const;
export type LocalToolName = (typeof LocalToolName)[number];

export type LocalRiskLevel = "low" | "medium" | "high";

export interface AuditRecord {
  id: string;
  clientId: string;
  tool: LocalToolName;
  risk: LocalRiskLevel;
  approved: boolean;
  decidedBy: "auto" | "user" | "policy";
  startedAt: number;
  finishedAt: number;
  summary: string;
}

export interface DispatchResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  audit: AuditRecord;
}

export interface DispatchOptions {
  id?: string;
  risk?: LocalRiskLevel;
  /** 覆盖底层 fetch 超时（毫秒） */
  timeoutMs?: number;
}

export class BridgeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export class BridgeClientSdk {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private async post(path: string, body: unknown, timeoutMs?: number): Promise<DispatchResult> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs ?? 120_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        throw new BridgeError(
          res.status,
          String(json.error ?? "error"),
          String(json.message ?? res.statusText),
        );
      }
      return json as unknown as DispatchResult;
    } finally {
      clearTimeout(t);
    }
  }

  /** 按用户下发（生产主入口）：路由到该用户当前在线的桌面客户端 */
  async dispatchToUser(
    userId: string,
    tool: LocalToolName,
    params: unknown,
    opts: DispatchOptions = {},
  ): Promise<DispatchResult> {
    return this.post(
      `/v1/users/${encodeURIComponent(userId)}/tool`,
      { id: opts.id, tool, params, risk: opts.risk },
      opts.timeoutMs,
    );
  }

  async dispatchToSession(
    sessionId: string,
    tool: LocalToolName,
    params: unknown,
    opts: DispatchOptions = {},
  ): Promise<DispatchResult> {
    return this.post(
      `/v1/sessions/${encodeURIComponent(sessionId)}/tool`,
      { id: opts.id, tool, params, risk: opts.risk },
      opts.timeoutMs,
    );
  }

  async dispatchToClient(
    clientId: string,
    tool: LocalToolName,
    params: unknown,
    opts: DispatchOptions = {},
  ): Promise<DispatchResult> {
    return this.post(
      `/v1/clients/${encodeURIComponent(clientId)}/tool`,
      { id: opts.id, tool, params, risk: opts.risk },
      opts.timeoutMs,
    );
  }

  /** 查询用户当前绑定的客户端状态（404 = 未绑定在线客户端，返回 null） */
  async getUserClient(userId: string): Promise<Record<string, unknown> | null> {
    const res = await fetch(`${this.baseUrl}/v1/users/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (res.status === 404) return null;
    return (await res.json()) as Record<string, unknown>;
  }

  async listClients(): Promise<{ clients: unknown[] }> {
    const res = await fetch(`${this.baseUrl}/v1/clients`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    return (await res.json()) as { clients: unknown[] };
  }

  async listSessions(): Promise<{ sessions: { sessionId: string; clientId: string }[] }> {
    const res = await fetch(`${this.baseUrl}/v1/sessions`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    return (await res.json()) as { sessions: { sessionId: string; clientId: string }[] };
  }
}
