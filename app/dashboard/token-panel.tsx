"use client";

import { useState, useCallback } from "react";
import { Badge, Button, Input } from "@zmzai/theme";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@zmzai/theme";
import { cnyYuanToMicros } from "@/providers/billing/currency";

interface Key {
  _id: string;
  prefix: string;
  name: string;
  status: string;
  rateLimitPerMinute: number;
  monthlySpendLimitMicros: number;
  monthlySpendUsedMicros: number;
  lastUsedAt: string | null;
}

export function TokenPanel({ initialKeys, models }: { initialKeys: Key[]; models: string[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [createOpen, setCreateOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setRevokingId(id);
    const res = await fetch(`/api/me/keys/${id}`, { method: "DELETE" });
    if (res.ok)
      setKeys((prev) => prev.map((key) => (key._id === id ? { ...key, status: "revoked" } : key)));
    setRevokingId(null);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "从未使用";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`;
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  const activeCount = keys.filter((k) => k.status === "active").length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-muted">
            共 {keys.length} 个 Key
            {activeCount > 0 && (
              <span className="ml-2">
                ·{" "}
                <span className="text-success">{activeCount} 个启用中</span>
              </span>
            )}
          </h2>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <Button onClick={() => setCreateOpen(true)}>创建 API Key</Button>
          <DialogContent>
            <CreateKeyDialog
              models={models}
              onCreated={(record, key, rpm, monthlySpendLimitMicros) => {
                setKeys((prev) => [
                  {
                    ...record,
                    rateLimitPerMinute: rpm,
                    monthlySpendLimitMicros,
                    monthlySpendUsedMicros: 0,
                    lastUsedAt: null,
                  },
                  ...prev,
                ]);
              }}
              onClose={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Key List */}
      {keys.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line py-24 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-surface">
            <svg className="h-10 w-10 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-ink">还没有 API Key</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
            创建你的第一个 Key 开始调用模型。每个 Key 可以单独设置权限和限额。
          </p>
          <Button className="mt-6" onClick={() => setCreateOpen(true)}>
            创建 API Key
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {keys.map((key) => (
            <div
              key={key._id}
              className={`group relative rounded-xl border bg-bg p-5 transition-all duration-200 hover:border-line-strong hover:shadow-md ${
                key.status === "active" ? "border-line" : "border-line/50 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-6">
                {/* Left: Key Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="truncate text-base font-semibold text-ink">{key.name}</h3>
                    <Badge variant={key.status === "active" ? "success" : "outline"} size="sm">
                      {key.status === "active" ? "启用" : "已吊销"}
                    </Badge>
                  </div>
                  <div className="mt-3 font-mono text-sm text-muted">
                    <code className="rounded-lg bg-surface px-2.5 py-1">{key.prefix}…</code>
                  </div>
                </div>

                {/* Right: Meta + Actions */}
                <div className="flex shrink-0 items-start gap-8 text-xs text-muted">
                  <div className="space-y-1.5 text-right">
                    <div className="font-mono text-sm font-medium">{key.rateLimitPerMinute}/min</div>
                    <div className="text-xs">{formatDate(key.lastUsedAt)}</div>
                  </div>

                  {key.status === "active" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(key._id)}
                      disabled={revokingId === key._id}
                      className="shrink-0 text-danger/70 opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                    >
                      {revokingId === key._id ? "吊销中…" : "吊销"}
                    </Button>
                  )}
                </div>
              </div>

              {/* Spend hint (if restricted) */}
              {key.monthlySpendLimitMicros > 0 && (
                <div className="mt-4 border-t border-line pt-4 text-xs text-muted">
                  月限额: ¥{(key.monthlySpendLimitMicros / 1000000).toFixed(2)}
                  {key.monthlySpendUsedMicros > 0 &&
                    ` · 已用: ¥{(key.monthlySpendUsedMicros / 1000000).toFixed(2)}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create Key Dialog                                                   */
/* ------------------------------------------------------------------ */

function CreateKeyDialog({
  models,
  onCreated,
  onClose,
}: {
  models: string[];
  onCreated: (
    record: Key,
    key: string,
    rpm: number,
    monthlySpendLimitMicros: number
  ) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [rpm, setRpm] = useState(60);
  const [spendYuan, setSpendYuan] = useState(0);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyKey = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback */
    }
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const monthlySpendLimitMicros = cnyYuanToMicros(spendYuan);
    const res = await fetch("/api/me/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        allowedModels: modelsText.split(",").map((item) => item.trim()).filter(Boolean),
        rateLimitPerMinute: rpm,
        monthlySpendLimitMicros,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "创建失败");
    setNewKey(json.key);
    onCreated(json.record, json.key, rpm, monthlySpendLimitMicros);
    setName("");
    setModelsText("");
  };

  /* Success view — show the new key once */
  if (newKey) {
    return (
      <div>
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15">
            <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <DialogTitle className="text-lg font-semibold text-ink">Key 创建成功</DialogTitle>
        </div>

        <p className="mb-4 text-sm text-muted">
          此 Key 仅显示一次，请立即复制保存。关闭弹窗后将无法再次查看完整 Key。
        </p>

        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">API Key</span>
            <button
              onClick={() => copyKey(newKey)}
              className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink transition-colors hover:bg-accent/80"
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <code className="block break-all font-mono text-sm leading-relaxed text-ink">
            {newKey}
          </code>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">
            查看调用示例
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-dark-bg p-4 font-mono text-xs leading-relaxed text-dark-ink">
{`curl https://m.zmzai.cloud/api/v1/chat/completions \\
  -H "Authorization: Bearer ${newKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"YOUR_MODEL_ID","messages":[{"role":"user","content":"你好"}]}'`}
          </pre>
        </details>

        <div className="mt-6 flex justify-end">
          <DialogClose asChild>
            <Button onClick={onClose} className="px-6">
              完成
            </Button>
          </DialogClose>
        </div>
      </div>
    );
  }

  /* Form view */
  return (
    <form onSubmit={create}>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold text-ink">创建 API Key</DialogTitle>
        <DialogDescription className="text-sm text-muted">
          配置权限和限额后即可使用
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        {/* Name */}
        <label className="block space-y-2">
          <span className="text-sm font-medium text-ink-2">名称</span>
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：本地开发、生产环境"
          />
        </label>

        {/* Allowed Models */}
        <label className="block space-y-2">
          <span className="text-sm font-medium text-ink-2">
            允许模型{" "}
            <span className="font-normal text-muted">(逗号分隔，留空=全部)</span>
          </span>
          <Input
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            placeholder="deepseek-v4-flash, gpt-5.6-sol"
            className="font-mono text-sm"
          />
        </label>

        {/* Rate Limit & Spend Limit */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <span className="block text-sm font-medium text-ink-2">限速（次/分）</span>
            <Input
              type="number"
              min="1"
              value={rpm}
              onChange={(e) => setRpm(Number(e.target.value))}
              className="mt-2"
            />
          </div>
          <div className="space-y-2">
            <span className="block text-sm font-medium text-ink-2">月消费上限（元）</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={spendYuan}
              onChange={(e) => setSpendYuan(Number(e.target.value))}
              className="mt-2"
            />
            <span className="mt-1.5 block text-xs text-muted">0 = 不限</span>
          </div>
        </div>

        {/* Available models */}
        {models.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              可用模型
            </p>
            <div className="flex flex-wrap gap-2">
              {models.slice(0, 8).map((model) => (
                <span
                  key={model}
                  className="inline-block rounded-full bg-surface px-2.5 py-1 font-mono text-xs text-muted"
                >
                  {model}
                </span>
              ))}
              {models.length > 8 && (
                <span className="inline-flex items-center rounded-full bg-surface px-2.5 py-1 text-xs text-muted">
                  +{models.length - 8} 更多
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            取消
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy} className="px-6">
          {busy ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              创建中…
            </span>
          ) : (
            "创建 Key"
          )}
        </Button>
      </div>
    </form>
  );
}
