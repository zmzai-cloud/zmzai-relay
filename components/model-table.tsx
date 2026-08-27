"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "@zmzai/theme";
import type { PublicChannel } from "@/providers/catalog/public-models";
import { moneyMicros } from "@/providers/catalog/public-models";

type FlatModel = {
  key: string;
  channel: string;
  model: string;
  maxInputTokens: number;
  inputPricePer1kMicros: number;
  outputPricePer1kMicros: number;
  cacheReadPricePer1kMicros: number;
};

type SortKey = "input" | "output" | "context";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

const sortValue = (row: FlatModel, key: SortKey): number => {
  if (key === "context") return row.maxInputTokens;
  if (key === "input") return row.inputPricePer1kMicros;
  return row.outputPricePer1kMicros;
};

/**
 * 扁平模型表（OpenRouter 式）：一行一个模型，渠道作为行内属性。
 * 首页、/models 共用，保证全站只有一种模型展示语言。
 * client 组件：模型名即时搜索 + 表头点击排序（升↔降切换）。
 */
export function ModelTable({ channels }: { channels: PublicChannel[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);

  const rows = useMemo<FlatModel[]>(
    () =>
      channels.flatMap((channel) =>
        channel.models.map((model) => ({
          key: `${channel.channel}-${model.model}`,
          channel: channel.channel,
          model: model.model,
          maxInputTokens: model.maxInputTokens,
          inputPricePer1kMicros: model.inputPricePer1kMicros,
          outputPricePer1kMicros: model.outputPricePer1kMicros,
          cacheReadPricePer1kMicros: model.cacheReadPricePer1kMicros,
        })),
      ),
    [channels],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((row) => `${row.model} ${row.channel}`.toLowerCase().includes(q)) : rows;
    if (!sort) return filtered;
    const sorted = [...filtered].sort((a, b) => sortValue(a, sort.key) - sortValue(b, sort.key));
    return sort.dir === "asc" ? sorted : sorted.reverse();
  }, [rows, query, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const thSort = (key: SortKey) => {
    const active = sort?.key === key;
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-accent ${active ? "text-accent" : ""}`}
        aria-label={`按${key === "context" ? "上下文" : key === "input" ? "输入价" : "输出价"}排序`}
      >
        {key === "context" ? "上下文" : key === "input" ? "输入 / 1K" : "输出 / 1K"}
        <Icon name={active && sort?.dir === "asc" ? "arrow-up" : "arrow-down"} size={11} className={active ? "" : "opacity-30"} />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2 focus-within:border-accent">
        <Icon name="search" size={14} className="text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索模型或渠道…"
          className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-ink-3"
        />
        <span className="font-mono text-[11px] text-ink-3">{visible.length}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-bg">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left font-mono text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">模型</th>
              <th className="px-4 py-2.5 font-normal">渠道</th>
              <th className="px-4 py-2.5 text-right font-normal">{thSort("context")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{thSort("input")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{thSort("output")}</th>
              <th className="px-4 py-2.5 text-right font-normal">缓存读 / 1K</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((row) => (
              <tr key={row.key} className="transition-colors hover:bg-surface">
                <td className="px-4 py-3">
                  <Link href={`/models/${encodeURIComponent(row.model)}`} className="inline-flex items-center gap-1.5 font-medium hover:text-accent-readable">
                    {row.model}
                    <Icon name="arrow-right" size={12} className="text-muted" />
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{row.channel}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-muted">{row.maxInputTokens.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{moneyMicros(row.inputPricePer1kMicros)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{moneyMicros(row.outputPricePer1kMicros)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-muted">
                  {row.cacheReadPricePer1kMicros > 0 ? moneyMicros(row.cacheReadPricePer1kMicros) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
