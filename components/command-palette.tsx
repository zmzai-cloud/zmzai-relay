"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@zmzai/theme";

export type PaletteItem = {
  label: string;
  hint?: string;
  group: "导航" | "模型" | "动作";
  icon?: "grid" | "book" | "home" | "key" | "activity" | "receipt" | "wallet" | "gauge" | "coins" | "link" | "users" | "trend-up" | "sliders" | "copy" | "arrow-right";
  keywords?: string;
  run: () => void;
};

/**
 * ⌘K / Ctrl+K 命令面板：纯手写 overlay（无新依赖）。
 * 键盘：↑↓ 选择、Enter 确认、Esc 关闭；输入即时过滤（label/hint/keywords 子串匹配）。
 */
export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // 等一帧让 overlay 挂载后再聚焦，避免被浏览器焦点还原打断
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((c) => Math.min(c + 1, filtered.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = filtered[cursor];
        if (item) {
          onClose();
          item.run();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, cursor, onClose]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const execute = (index: number) => {
    const item = filtered[index];
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onClick={onClose} role="presentation">
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-bg shadow-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="search" size={14} className="text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索页面、模型或执行动作…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-3">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center font-mono text-xs text-ink-3">没有匹配结果</p>
          ) : (
            filtered.map((item, index) => (
              <button
                key={`${item.group}-${item.label}`}
                type="button"
                data-index={index}
                onClick={() => execute(index)}
                onMouseEnter={() => setCursor(index)}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
                  index === cursor ? "bg-surface text-accent-readable" : "text-ink-2"
                }`}
              >
                {item.icon ? <Icon name={item.icon} size={13} className="shrink-0 text-muted" /> : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint ? <span className="shrink-0 font-mono text-[11px] text-ink-3">{item.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
