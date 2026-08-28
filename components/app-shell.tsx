"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { AppShell as ThemeAppShell, AppShellAccountRow, Button } from "@zmzai/theme";
import type { AppNavSection, AppPaletteItem } from "@zmzai/theme";
import { LogoutButton } from "@/components/logout-button";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";

const publicSection: AppNavSection = {
  label: "广场",
  items: [
    { label: "模型广场", href: "/models", icon: "grid", keywords: "models model" },
    { label: "API 文档", href: "/docs", icon: "book", keywords: "docs api" },
  ],
};

const consoleSection: AppNavSection = {
  label: "控制台",
  items: [
    { label: "概览", href: "/dashboard", icon: "home", keywords: "overview dashboard" },
    { label: "API Keys", href: "/dashboard/keys", icon: "key", keywords: "keys token" },
    { label: "用量", href: "/dashboard/activity", icon: "activity", keywords: "usage calls" },
    { label: "账单", href: "/dashboard/ledger", icon: "receipt", keywords: "ledger billing" },
    { label: "额度充值", href: "/dashboard/billing", icon: "wallet", keywords: "topup balance" },
  ],
};

const adminSection: AppNavSection = {
  label: "管理",
  items: [
    { label: "运营概览", href: "/admin", icon: "gauge", keywords: "ops overview" },
    { label: "模型与价格", href: "/admin/models", icon: "coins", keywords: "prices models" },
    { label: "渠道与路由", href: "/admin/channels", icon: "link", keywords: "channels routing" },
    { label: "用户与余额", href: "/admin/users", icon: "users", keywords: "users balance" },
    { label: "毛利报表", href: "/admin/profit", icon: "trend-up", keywords: "profit margin" },
    { label: "充值订单", href: "/admin/orders", icon: "receipt", keywords: "orders topup" },
    { label: "调用与账本", href: "/admin/activity", icon: "activity", keywords: "usage ledger" },
    { label: "运营调整", href: "/admin/operations", icon: "sliders", keywords: "operations" },
    { label: "全部 Token", href: "/admin/keys", icon: "key", keywords: "all keys" },
  ],
};

/**
 * relay 站点装配层 — theme AppShell 的薄封装，保持旧 props 签名兼容（页面零改动）。
 * 站点信息（导航分组/品牌/余额/⌘K 条目/账户块）在此注入，UI 结构由 @zmzai/theme 统一。
 */
export function AppShell({
  user,
  isAdminUser = false,
  children,
}: {
  user?: { name: string } | null;
  isAdminUser?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [balanceLabel, setBalanceLabel] = useState<string | null>(null);
  const [modelNames, setModelNames] = useState<string[]>([]);

  const isLoggedIn = Boolean(user);
  const sections = useMemo<AppNavSection[]>(() => {
    const all = [publicSection];
    // 未登录不渲染控制台组（点了也只会被 307 到登录页），登录后出现
    if (user) all.push(consoleSection);
    if (isAdminUser) all.push(adminSection);
    return all;
  }, [isAdminUser, user]);

  // 登录后拉取余额与模型列表（401 时静默跳过，不干扰渲染）
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/me/balance")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.availableMicros === "number") {
          setBalanceLabel(`¥${((data.availableMicros * 800) / 100000000).toFixed(2)}`);
        }
      })
      .catch(() => {});
    fetch("/api/v1/models")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.models)) setModelNames(data.models.map((m: { model: string }) => m.model));
      })
      .catch(() => {});
  }, [isLoggedIn]);

  const copyBaseUrl = useCallback(() => {
    void navigator.clipboard?.writeText("https://m.zmzai.cloud/v1");
  }, []);

  const paletteItems = useMemo<AppPaletteItem[]>(() => {
    const navItems: AppPaletteItem[] = sections.flatMap((section) =>
      section.items.map((item) => ({
        label: item.label,
        hint: section.label,
        group: "导航",
        icon: item.icon,
        keywords: item.keywords,
        run: () => router.push(item.href),
      })),
    );
    const modelItems: AppPaletteItem[] = modelNames.map((name) => ({
      label: name,
      hint: "模型",
      group: "模型",
      icon: "arrow-right",
      run: () => router.push(`/models/${encodeURIComponent(name)}`),
    }));
    const actions: AppPaletteItem[] = [
      { label: "复制 API Base URL", hint: "https://m.zmzai.cloud/v1", group: "动作", icon: "copy", run: copyBaseUrl },
    ];
    return [...navItems, ...modelItems, ...actions];
  }, [sections, modelNames, router, copyBaseUrl]);

  const account = isLoggedIn ? (
    <AppShellAccountRow name={user!.name} badge={isAdminUser ? "admin" : undefined}>
      {isAdminUser ? (
        <Link href="/dashboard" className="text-muted hover:text-accent">用户端</Link>
      ) : null}
      <LogoutButton />
    </AppShellAccountRow>
  ) : (
    <div className="mt-auto border-t border-line px-2 pt-3">
      <Link href={`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard")}`}>
        <Button size="sm" className="w-full">登录</Button>
      </Link>
    </div>
  );

  return (
    <ThemeAppShell
      brand={{ label: "relay", suffix: "· zmzai.cloud", href: "/" }}
      sections={sections}
      pathname={pathname}
      link={Link}
      account={account}
      headerExtras={balanceLabel ? <span className="font-mono text-xs text-muted">{balanceLabel}</span> : null}
      paletteItems={paletteItems}
    >
      {children}
    </ThemeAppShell>
  );
}
