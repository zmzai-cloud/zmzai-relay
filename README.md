# Relay · zmzai.cloud

`m.zmzai.cloud` 是 ZMZ AI 的模型中转与额度服务。

它负责把用户登录态、可用模型、额度钱包、上游请求和服务间调用边界放在同一个地方。Agent 和 Sandbox 不直接接触用户模型密钥；它们通过 Relay 获取可用模型并完成调用。

## 职责

- 维护公开模型目录和用户可用模型；
- 管理用户钱包、套餐、额度周期和调用扣费；
- 代理上游模型请求，并设置超时、错误边界和安全 fetch；
- 给 Sandbox 解析 `sandbox_key`，判断调用方是否有权限执行；
- 给 Agent 提供内部模型调用接口，支持服务密钥轮换；
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

## 相关仓库

- [`zmzai-agent`](https://github.com/zmzai-cloud/zmzai-agent)：Agent 编排层，通过 Relay 调模型；
- [`zmzai-sandbox`](https://github.com/zmzai-cloud/zmzai-sandbox)：执行层，通过 Relay 校验 `sandbox_key` 和模型调用；
- [`zmzai-db`](https://github.com/zmzai-cloud/zmzai-db)：共享账号与 session schema。

Apache-2.0 · 知末智云
