"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Badge, Input } from "@zmzai/theme";
import { cnyMicrosLabel } from "@/providers/billing/currency";

/** 搜索结果条目——与 /api/admin/users/search 的返回形状一致。 */
export interface WalletTarget {
  id: string;
  name: string;
  email: string;
  role: string;
  status?: string;
  accounts?: { provider: string; username: string | null }[];
  balanceMicros: number;
  availableMicros: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  apple: "Apple",
};

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider.toLowerCase()] ?? provider;
}

/** 供父组件命令式回填（例如「补给我自己」），回填不触发搜索。 */
export interface UserPickerHandle {
  fill: (user: WalletTarget) => void;
  clear: () => void;
}

/**
 * 管理员用的人选择器：按邮箱 / 站内昵称 / 第三方登录名（GitHub 等）搜索，
 * 点选后把整个用户对象交给父组件，避免手输 Mongo ID。
 */
export const UserPicker = forwardRef<
  UserPickerHandle,
  {
    value: WalletTarget | null;
    onChange: (user: WalletTarget | null) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
  }
>(function UserPicker(
  {
    value,
    onChange,
    placeholder = "按邮箱、昵称或 GitHub 用户名搜索（至少 2 个字符）",
    disabled = false,
    className = "",
  },
  ref,
) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WalletTarget[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** 选中后回填输入框，这次回填不能再次触发搜索。 */
  const skipSearch = useRef(false);

  // 输入 debounce 搜索（≥2 字符）
  useEffect(() => {
    const keyword = query.trim();
    if (skipSearch.current) { skipSearch.current = false; return; }
    if (keyword.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/admin/users/search?q=${encodeURIComponent(keyword)}`)
        .then((res) => (res.ok ? res.json() : { users: [] }))
        .then((data) => { if (!cancelled) { setResults(data.users ?? []); setOpen(true); } })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  // 点击外部收起下拉
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function pick(user: WalletTarget) {
    skipSearch.current = true;
    setQuery(user.email);
    setResults([]);
    setOpen(false);
    onChange(user);
  }

  function clear() {
    skipSearch.current = true;
    setQuery("");
    setResults([]);
    setOpen(false);
    onChange(null);
  }

  useImperativeHandle(ref, () => ({ fill: pick, clear }), [onChange]);

  return (
    <div ref={containerRef} className={`relative flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        <Input
          value={query}
          disabled={disabled}
          onChange={(event) => { setQuery(event.target.value); onChange(null); }}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className="font-mono text-sm"
        />
        {value ? (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            清除
          </button>
        ) : null}
      </div>

      {searching ? <p className="text-xs text-muted">搜索中…</p> : null}

      {open && !searching && results.length > 0 ? (
        <ul className="absolute top-full z-10 mt-1 max-h-72 w-full divide-y divide-line overflow-auto rounded-md border border-line bg-bg shadow-sm">
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => pick(user)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{user.name}</span>
                    {user.accounts?.length
                      ? user.accounts.map((account) => (
                          <Badge key={account.provider} variant="outline" size="sm">
                            {providerLabel(account.provider)}
                            {account.username ? ` · ${account.username}` : ""}
                          </Badge>
                        ))
                      : null}
                    {user.role === "admin" ? <Badge variant="outline" size="sm">admin</Badge> : null}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted">{user.email}</span>
                </span>
                <Badge variant="outline" size="sm" className="shrink-0 font-mono">
                  {cnyMicrosLabel(user.availableMicros, 2)}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open && !searching && results.length === 0 && query.trim().length >= 2 ? (
        <p className="text-xs text-muted">没有匹配的用户</p>
      ) : null}

      {value ? (
        <p className="text-xs text-muted">
          已选择：<span className="font-mono">{value.email}</span> · 当前可用{" "}
          <span className="font-mono">{cnyMicrosLabel(value.availableMicros, 2)}</span>
        </p>
      ) : null}
    </div>
  );
});
