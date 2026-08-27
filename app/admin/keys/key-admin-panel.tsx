"use client";

import { useState } from "react";
import { Badge, Button, Input } from "@zmzai/theme";

interface KeyItem {
  _id: string;
  prefix: string;
  name: string;
  status: string;
  quotaTotalTokens: number;
  quotaUsedTokens: number;
  rateLimitPerMinute: number;
  allowedModels: string[];
}

export function KeyAdminPanel({ initialKeys }: { initialKeys: KeyItem[] }) {
  const [keys, setKeys] = useState<KeyItem[]>(initialKeys);
  const [name, setName] = useState("");
  const [quota, setQuota] = useState(0);
  const [rpm, setRpm] = useState(60);
  const [models, setModels] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<KeyItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuota, setEditQuota] = useState(0);
  const [editRpm, setEditRpm] = useState(60);
  const [editModels, setEditModels] = useState("");

  function startEdit(k: KeyItem) {
    setEditingKey(k);
    setEditName(k.name);
    setEditQuota(k.quotaTotalTokens);
    setEditRpm(k.rateLimitPerMinute);
    setEditModels(k.allowedModels.join(", "));
    setError(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingKey) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/keys/${editingKey._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        quotaTotalTokens: editQuota,
        rateLimitPerMinute: editRpm,
        allowedModels: editModels.split(",").map((s) => s.trim()).filter(Boolean),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "保存失败");
      return;
    }
    const j = await res.json();
    setKeys((prev) => prev.map((k) => (k._id === editingKey._id ? { ...k, ...j.key } : k)));
    setEditingKey(null);
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNewKey(null);
    const res = await fetch("/api/admin/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        quotaTotalTokens: quota,
        rateLimitPerMinute: rpm,
        allowedModels: models.split(",").map((s) => s.trim()).filter(Boolean),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "创建失败");
      return;
    }
    const j = await res.json();
    setNewKey(j.key);
    setKeys((prev) => [{ ...j.record, quotaUsedTokens: 0 }, ...prev]);
    setName("");
    setQuota(0);
    setModels("");
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/admin/keys/${id}`, { method: "DELETE" });
    if (res.ok) {
      setKeys((prev) => prev.map((k) => (k._id === id ? { ...k, status: "revoked" } : k)));
    }
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:items-start">
      <section>
        <h2 className="mb-3 text-lg font-semibold">已分发（{keys.length}）</h2>
        {keys.length === 0 ? (
          <p className="rounded-lg border border-line px-4 py-6 text-sm text-muted">还没有 key，先在右侧创建第一个。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-bg">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
                  <th className="px-4 py-2.5 font-normal">名称</th>
                  <th className="px-4 py-2.5 font-normal">状态</th>
                  <th className="px-4 py-2.5 font-normal">额度</th>
                  <th className="px-4 py-2.5 text-right font-normal">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {keys.map((k) => (
                  <tr key={k._id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium">{k.name}</p>
                      <p className="font-mono text-xs text-muted">{k.prefix}… · {k.rateLimitPerMinute}/min</p>
                      <p className="font-mono text-xs text-muted">{k.allowedModels.length > 0 ? k.allowedModels.join(", ") : "全部模型"}</p>
                    </td>
                    <td className="px-4 py-3"><Badge variant={k.status === "active" ? "success" : "danger"} size="sm">{k.status === "active" ? "生效" : "已吊销"}</Badge></td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {k.quotaTotalTokens > 0 ? `${k.quotaUsedTokens.toLocaleString()} / ${k.quotaTotalTokens.toLocaleString()} tok` : "不限"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {k.status === "active" ? (
                        <div className="flex shrink-0 items-center justify-end gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => startEdit(k)}>编辑</Button>
                          <Button type="button" variant="danger" size="sm" onClick={() => revoke(k._id)}>吊销</Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-line bg-bg p-5">
          <h2 className="text-lg font-semibold">创建 Key</h2>
          <form onSubmit={createKey} className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted">名称（备注用途）</span>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="muzhi 后端 / 张三" />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted">额度（tokens，0=不限）</span>
                <Input type="number" value={quota} onChange={(e) => setQuota(Number(e.target.value))} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted">限流（次/分钟）</span>
                <Input type="number" value={rpm} onChange={(e) => setRpm(Number(e.target.value))} />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted">允许模型（逗号分隔，空=全部）</span>
              <Input value={models} onChange={(e) => setModels(e.target.value)} className="font-mono text-xs" placeholder="gpt-5.6-sol, gpt-5.6-terra" />
            </label>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" disabled={busy} className="self-start">{busy ? "创建中…" : "创建 Key"}</Button>
          </form>
        </div>

        {editingKey ? (
          <div className="rounded-lg border border-line bg-bg p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">编辑 Key · {editingKey.name}</h2>
              <button type="button" onClick={() => setEditingKey(null)} className="text-sm text-muted underline underline-offset-4">取消</button>
            </div>
            <form onSubmit={saveEdit} className="mt-4 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted">名称（备注用途）</span>
                <Input required value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="muzhi 后端 / 张三" />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted">额度（tokens，0=不限）</span>
                  <Input type="number" min="0" value={editQuota} onChange={(e) => setEditQuota(Number(e.target.value))} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted">限流（次/分钟）</span>
                  <Input type="number" min="1" value={editRpm} onChange={(e) => setEditRpm(Number(e.target.value))} />
                </label>
              </div>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted">允许模型（逗号分隔，空=全部）</span>
                <Input value={editModels} onChange={(e) => setEditModels(e.target.value)} className="font-mono text-xs" placeholder="gpt-5.6-sol, gpt-5.6-terra" />
              </label>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy} className="self-start">{busy ? "保存中…" : "保存修改"}</Button>
            </form>
          </div>
        ) : null}

        {newKey ? (
          <div className="rounded-lg border border-accent bg-bg p-5">
            <p className="font-mono text-xs text-muted">新 Key 只显示这一次，立刻复制保存</p>
            <code className="mt-2 block break-all font-mono text-sm text-accent-readable">{newKey}</code>
            <p className="mt-4 text-xs text-muted">调用方式：</p>
            <pre className="mt-1 overflow-x-auto rounded-md bg-surface p-3 font-mono text-xs text-ink-2">{`curl https://m.zmzai.cloud/api/v1/chat/completions \\
  -H "Authorization: Bearer ${newKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.6-terra","reasoning_effort":"high","messages":[{"role":"user","content":"你好"}]}'`}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
