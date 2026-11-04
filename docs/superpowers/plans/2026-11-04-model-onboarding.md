# Model Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理后台安全接入、逐个验证和发布模型，并独立控制公开展示与调用。

**Architecture:** 在现有 ModelPrice 上增加向后兼容的展示开关；将上游探测、价格预览和独立草稿发布实现为服务端模块，向导通过管理员 API 调用。发布在 MongoDB 事务中校验快照和合并配置；现有计费和路由继续是唯一事实源。

**Tech Stack:** Next.js 15、React 19、TypeScript、Mongoose 8、MongoDB、Zod、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-04-model-onboarding-design.md`

## Global Constraints

- 不改变现有模型 ID、调用协议、渠道优先级、计费、冷却和历史数据；现有记录缺失展示字段时默认展示。
- 管理员接口必须鉴权，网络访问使用 `safeUpstreamFetch`；密钥和上游原始响应不能泄露到浏览器、日志或审计。
- 真实测试可能收费，显示提示；不增加定时探测或自动同步官方价格。
- 价格界面使用元/百万 token，数据库沿用微元/千 token；成本未知不得当作零。
- 草稿与线上数据隔离；发布用事务及并发检测，失败保留草稿，不能产生部分线上配置。

## Review Focus

- 旧模型缺失展示字段时继续可发现；隐藏后已知 ID 仍能调用。
- 给在线模型新增渠道时不得改变它的价格、开关或现有映射。
- 修改地址、密钥或映射后旧测试结果立即失效。
- 并发修改或事务失败不得覆盖其他管理员配置或部分上线。
- 价格精度、缓存回退及执行倍率与实际扣费一致，未知成本不显示为零利润。

---

### Task 1: 模型展示与调用独立控制

**Files:** Modify `providers/database/mongodb/models/model-price.ts`, `providers/catalog/public-models.ts`, `app/api/admin/prices/route.ts`, `app/admin/models/page.tsx`, `app/admin/models/models-panel.tsx`, `app/api/v1/models/route.ts`; create `tests/model-visibility.test.ts` and test setup in `package.json`.

**Interfaces:** `ModelPriceRecord.publicVisible: boolean` defaults to true. Admin price API accepts optional `publicVisible`, preserving the previous value when omitted. Public catalog filters `publicVisible !== false`; chat completions continue using only `enabled`.

- [ ] Add Vitest and a `test` script; write tests asserting missing `publicVisible` is visible, false is omitted from every user-facing catalog/selector and model discovery, but does not reject a direct call by ID; `enabled: false` rejects direct calls and is not listed.
- [ ] Run `pnpm test -- tests/model-visibility.test.ts`; verify the new cases fail before implementation.
- [ ] Implement the field and catalog filtering; expose separate “公开展示” and “开放调用” controls in the admin form and row, including both values in updates so toggling one cannot reset the other. Preserve backward compatibility for old admin clients that omit the new field.
- [ ] Run the targeted tests and `pnpm typecheck`; verify they pass. Confirm admin lists hidden models and model detail cannot reveal them.
- [ ] Commit the scoped files with `git commit -m 'feat: separate model visibility from availability'`.

### Task 2: 单模型探测与计费预览

**Files:** Create `providers/catalog/model-probe.ts`, `providers/catalog/price-preview.ts`, `providers/database/mongodb/models/model-probe.ts`, `app/api/admin/model-probes/route.ts`, `tests/model-probe.test.ts`, `tests/price-preview.test.ts`; modify `app/api/v1/chat/completions/route.ts` only as needed to share pure pricing helpers without changing behavior; modify `app/admin/models/page.tsx` and `models-panel.tsx` for per-mapping test status.

**Interfaces:** `probeModel(input: {baseUrl: string; apiKey: string; upstreamModel: string}): Promise<ProbeResult>` returns status, timestamp, latency and sanitized category `auth | balance | rate_limit | upstream | timeout | other`; model-list success never counts as inference success. `previewPrice(input)` returns effective prices and per-token-type margin using the same rounding and cache fallback as actual billing. Store latest probe by channel ID and public/upstream mapping with a fingerprint of address, secret version and mapping, never the secret itself.

- [ ] Write tests for HTTP 401/403, 402, 429, 503, timeout and successful completion; verify 200 with invalid/missing choices is not successful, secrets are absent from persisted/result payloads, and changing address, key or mapping invalidates the prior result.
- [ ] Write price tests asserting ¥1/1M converts to 1000 micros/1K, nonrepresentable values are rejected, zero cache price uses the same input-price fallback as billing, execution multiplier rounds as billing does, and unknown cost / zero sale gives an unavailable margin.
- [ ] Run `pnpm test -- tests/model-probe.test.ts tests/price-preview.test.ts`; verify expected failures. Implement the shared price helper, probing service and authenticated route; tests must not mutate channel cooldown or another model's status. Tests of saved channels must resolve keys only server-side and validate requested model belongs to that channel.
- [ ] Add per-model test action and last-result display to the model admin view; distinguish untested, stale and failed. Run targeted tests and `pnpm typecheck`.
- [ ] Commit the scoped files with `git commit -m 'feat: add per-model probes and price preview'`.

### Task 3: 隔离草稿与事务发布

**Files:** Create `providers/database/mongodb/models/onboarding-draft.ts`, `providers/catalog/onboarding.ts`, `app/api/admin/onboarding/route.ts`, `app/api/admin/onboarding/[id]/route.ts`, `app/api/admin/onboarding/[id]/publish/route.ts`, `tests/onboarding.test.ts`.

**Interfaces:** `saveDraft(adminId, draft)` stores validated draft separately with a revision and snapshots of affected channel/model versions; `publishDraft(adminId, draftId, expectedRevision, acceptUntested)` returns published IDs or conflict. Draft GET responses omit secrets; updating a secret preserves the previous value when omitted and replaces it when supplied. Draft probe results are bound to the exact configuration fingerprint.

- [ ] Write integration tests using an isolated MongoDB replica set: saving an incomplete draft does not change public catalog, live channels, prices, or callability; adding a channel to an existing model preserves existing price and flags; duplicate public names require explicit selection or rename.
- [ ] Add tests for mismatched revisions, changed channel/model snapshots, changed credentials after test, duplicate publication, invalid pricing and injected transaction failure. All conflicts retain the draft, report a useful error, and leave live configuration unchanged; untested publish requires explicit `acceptUntested`.
- [ ] Run `pnpm test -- tests/onboarding.test.ts` against the test replica set; verify failures. Implement strict Zod validation, separate draft persistence and transactional publication with conditional updates/version checks, idempotency guard and audit records excluding secrets. Merge new mappings rather than replacing concurrent data.
- [ ] Verify `pnpm test -- tests/onboarding.test.ts` and `pnpm typecheck` pass. Verify unauthenticated and non-admin users cannot read, test, save or publish drafts.
- [ ] Commit scoped files with `git commit -m 'feat: add isolated model onboarding drafts'`.

### Task 4: 管理后台模型接入向导

**Files:** Create `app/admin/models/onboarding-wizard.tsx`, `app/api/admin/onboarding/models/route.ts`, `tests/onboarding-ui.test.tsx`; modify `app/admin/models/page.tsx`, `app/page.tsx`, `app/docs/page.tsx`, `app/dashboard/token-panel.tsx`.

**Interfaces:** `OnboardingWizard({channels, existingModels})` uses Task 2 probe/preview and Task 3 draft APIs. Model discovery uses authenticated safe upstream requests, returns a bounded list of IDs, and offers manual entry on failure. New-channel credentials are kept server-side in the draft and never echoed.

- [ ] Write UI tests for choosing an existing channel or adding a channel, discovery failure followed by manual entry, multiple models with partial probe failure, price validation, draft resumption, stale test indication and conflict response. Assert labels and controls are usable on narrow screens; test no secret is rendered after saving.
- [ ] Run `pnpm test -- tests/onboarding-ui.test.tsx`; verify expected failure. Implement channel/model selection, per-model pricing and preview, per-model test, explicit publish confirmation and draft resume. Default new public names to upstream names; show existing model prices and require separate confirmation before price changes.
- [ ] Replace the hardcoded DeepSeek examples in public docs and token panel with a currently available model or neutral clearly editable placeholder; do not claim disabled models are available.
- [ ] Run `pnpm test`, `pnpm typecheck` and `pnpm build`; manually verify the desktop and mobile flows, unavailable model-list fallback, and admin/user discovery behavior using a disposable test database and mock upstream (never production data). Record results and limitations.
- [ ] Commit scoped files with `git commit -m 'feat: add model onboarding wizard'`.
