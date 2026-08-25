# Relay · zmzai.cloud

`m.zmzai.cloud` 是 ZMZ AI 的模型中转与额度服务。

它负责把用户登录态、可用模型、额度钱包、上游请求和服务间调用边界放在同一个地方。Agent 和 Sandbox 不直接接触用户模型密钥；它们通过 Relay 获取可用模型并完成调用。

## 职责

- 维护公开模型目录和用户可用模型；
- 管理用户钱包、套餐、额度周期和调用扣费；
- 代理上游模型请求，并设置超时、错误边界和安全 fetch；
- 给 Sandbox 解析 `sandbox_key`，判断调用方是否有权限执行；
- 给 Agent 提供内部模型调用接口，支持服务密钥轮换；
- 给 Agent 提供**本机工具桥接**：需要用户本机能力（fs/shell/notify）时，经 `zmzai-bridge` 下发到用户的桌面客户端；
- 提供管理页，用于查看模型、钱包和运维状态。

## 当前边界

- 这是 ZMZ AI 内部的 Relay，不是通用商业 API 网关；
- 管理端依赖知末智云账号体系，并额外要求管理员角色；
- 额度、套餐和上游策略仍在迭代，README 只描述当前仓库边界。

## 目录

| 路径 | 说明 |
| --- | --- |
| `app/` | 公开页、dashboard、admin、models、docs |
| `providers/auth/` | 登录态、API key、sandbox key 与 Agent service auth |
| `providers/billing/` | 钱包、套餐、周期和扣费服务 |
| `providers/catalog/` | 公开模型目录 |
| `providers/bridge/` | 本地工具桥接：vendored bridge-sdk 与客户端单例 |
| `providers/network/` | 安全上游请求封装 |
| `scripts/seed-deepseek.mjs` | 初始化 DeepSeek 模型数据 |
| `memory/` | 运行事故和修复记录 |

## 本地运行

```bash
pnpm install
pnpm dev
```

常用检查：

```bash
pnpm typecheck
```

初始化模型目录：

```bash
pnpm seed:deepseek
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | 当前 Relay 服务地址 |
| `MONGODB_URI` | 无 | 与知末智云账号体系共用的 MongoDB |
| `AUTH_SECRET` | 无 | 必须与知末智云一致，用于校验 session |
| `SESSION_COOKIE_NAME` | `muzhi_session` | 登录态 cookie 名称 |
| `SESSION_COOKIE_DOMAIN` | 空 | 多子域共享登录时使用 |
| `RELAY_DEFAULT_UPSTREAM_TIMEOUT_MS` | `60000` | 上游模型请求默认超时 |
| `RELAY_INTERNAL_CRON_SECRET` | 空 | 内部定时任务密钥 |
| `RELAY_SANDBOX_SERVICE_SECRET_CURRENT` | 空 | Sandbox 调 Relay 的当前服务密钥 |
| `RELAY_SANDBOX_SERVICE_SECRET_PREVIOUS` | 空 | Sandbox 服务密钥轮换旧值 |
| `RELAY_AGENT_SERVICE_SECRET_CURRENT` | 空 | Agent 调 Relay 的当前服务密钥 |
| `RELAY_AGENT_SERVICE_SECRET_PREVIOUS` | 空 | Agent 服务密钥轮换旧值 |
| `RELAY_INTERNAL_ORIGIN` | `http://127.0.0.1:3002` | Agent 内部调用 Relay 的私网入口 |
| `RELAY_BRIDGE_URL` | `http://127.0.0.1:8787` | 本机工具桥接端点（zmzai-bridge） |
| `RELAY_BRIDGE_TOKEN` | 空（回退 dev 默认） | 桥接内部 API Token，生产必须设置 |

## 本机工具桥接（local-tool）

当 Agent 需要操作**用户自己的机器**（本机文件 / 本机命令 / 通知）时，调用
`POST /api/internal/agent/local-tool`（agent-service 鉴权）：

```json
{
  "tool": "fs.read",
  "params": { "path": "~/notes.txt" },
  "requestId": "optional-correlation-id"
}
```

- `userId` 取自 `x-zmzai-agent-user-id` 头（与 `/api/internal/agent/chat` 同源），Relay 校验用户存在且激活后，
  经 `zmzai-bridge` 的 `POST /v1/users/:userId/tool` 下发到该用户当前在线的桌面客户端。
- `GET /api/internal/agent/local-tool` 可探测用户是否绑定了在线客户端（`{ "bound": true|false }`），
  Agent 据此决定是否向模型暴露本机工具。
- 错误码：`409` 用户无在线客户端 / `504` 客户端长时间无响应（用户在审批或卡死）/ `502` 桥接异常。
- **执行边界**：`zmzai-sandbox` 的代码/命令在云端容器内执行，不经此通道；
  本通道只服务用户本机，且 `fs.write` / `shell.exec` 在客户端必弹用户审批。

## 相关仓库

- [`zmzai-agent`](https://github.com/zmzai-cloud/zmzai-agent)：Agent 编排层，通过 Relay 调模型、下发本机工具；
- [`zmzai-sandbox`](https://github.com/zmzai-cloud/zmzai-sandbox)：执行层，通过 Relay 校验 `sandbox_key` 和模型调用（云端容器内执行，不经桥）；
- [`zmzai-bridge`](https://github.com/zmzai-cloud/zmzai-bridge)：云端桥接端点，终止客户端反向隧道并做用户路由；
- [`zmzai-client`](https://github.com/zmzai-cloud/zmzai-client)：桌面客户端，本地审批 + 审计 + 受限执行；
- [`zmzai-db`](https://github.com/zmzai-cloud/zmzai-db)：共享账号与 session schema。

Apache-2.0 · 知末智云
