"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Badge, Button, Icon } from "@zmzai/theme";
import type { IconName } from "@zmzai/theme";
import { LogoutButton } from "@/components/logout-button";
import { CommandPalette } from "@/components/command-palette";
import type { PaletteItem } from "@/components/command-palette";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";

type NavItem = { label: string; href: string; icon: IconName; keywords?: string };
type NavSection = { label: string; items: NavItem[] };

const publicSection: NavSection = {
  label: "广场",
  items: [
    { label: "模型广场", href: "/models", icon: "grid", keywords: "models model" },
    { label: "API 文档", href: "/docs", icon: "book", keywords: "docs api" },
  ],
};

const consoleSection: NavSection = {
  label: "控制台",
  items: [
    { label: "概览", href: "/dashboard", icon: "home", keywords: "overview dashboard" },
    { label: "API Keys", href: "/dashboard/keys", icon: "key", keywords: "keys token" },
    { label: "用量", href: "/dashboard/activity", icon: "activity", keywords: "usage calls" },
    { label: "账单", href: "/dashboard/ledger", icon: "receipt", keywords: "ledger billing" },
    { label: "额度充值", href: "/dashboard/billing", icon: "wallet", keywords: "topup balance" },
  ],
};

const adminSection: NavSection = {
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

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarSections({ sections, pathname, onNavigate }: { sections: NavSection[]; pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">{section.label}</p>
          {section.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                  active ? "bg-surface font-medium text-accent-readable" : "text-muted hover:bg-surface hover:text-accent"
                }`}
              >
                <Icon name={item.icon} size={13} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function sidebarBrand() {
  return (
    <Link href="/" className="flex items-baseline gap-1.5 px-2">
      <span className="text-sm font-semibold tracking-tight">relay</span>
      <span className="font-mono text-[11px] text-ink-3">· zmzai.cloud</span>
    </Link>
  );
}

/**
 * 全站统一应用外壳（OpenRouter 式交互内核）：
 * 全高左侧 sidebar（广场/控制台/管理三组）+ 轻顶栏（⌘K + 余额）+ 账户块。
 * PublicShell / RelayShell 是它的薄封装，页面组件零改动。
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [balanceLabel, setBalanceLabel] = useState<string | null>(null);
  const [modelNames, setModelNames] = useState<string[]>([]);

  const isLoggedIn = Boolean(user);
  const sections = useMemo<NavSection[]>(() => {
    const all = [publicSection];
    // 未登录不渲染控制台组（点了也只会被 307 到登录页），登录后出现
    if (user) all.push(consoleSection);
    if (isAdminUser) all.push(adminSection);
    return all;
  }, [isAdminUser, user]);

  // 顶栏标题：当前激活项的 label（取最长匹配，/admin/models 优先于 /admin）
  const currentLabel = useMemo(() => {
    const matches = sections.flatMap((s) => s.items).filter((item) => isActive(pathname, item.href));
    if (!matches.length) return null;
    return matches.sort((a, b) => b.href.length - a.href.length)[0].label;
  }, [pathname, sections]);

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

  // ⌘K / Ctrl+K 全局快捷键
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copyBaseUrl = useCallback(() => {
    void navigator.clipboard?.writeText("https://m.zmzai.cloud/v1");
  }, []);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const navItems: PaletteItem[] = sections.flatMap((section) =>
      section.items.map((item) => ({
        label: item.label,
        hint: section.label,
        group: "导航" as const,
        icon: item.icon as PaletteItem["icon"],
        keywords: item.keywords,
        run: () => router.push(item.href),
      })),
    );
    const modelItems: PaletteItem[] = modelNames.map((name) => ({
      label: name,
      hint: "模型",
      group: "模型" as const,
      icon: "arrow-right" as const,
      run: () => router.push(`/models/${encodeURIComponent(name)}`),
    }));
    const actions: PaletteItem[] = [
      { label: "复制 API Base URL", hint: "https://m.zmzai.cloud/v1", group: "动作", icon: "copy", run: copyBaseUrl },
    ];
    return [...navItems, ...modelItems, ...actions];
  }, [sections, modelNames, router, copyBaseUrl]);

  const accountBlock = isLoggedIn ? (
    <div className="mt-auto flex flex-col gap-2 border-t border-line px-2 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs text-ink-2">{user?.name}</span>
        {isAdminUser ? <Badge variant="outline" size="sm">admin</Badge> : null}
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
        {isAdminUser ? (
          <Link href="/dashboard" className="text-muted hover:text-accent">用户端</Link>
        ) : null}
        <LogoutButton />
      </div>
    </div>
  ) : (
    <div className="mt-auto border-t border-line px-2 pt-3">
      <Link href={`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard")}`}>
        <Button size="sm" className="w-full">登录</Button>
      </Link>
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg">
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />

      {/* 移动端抽屉 */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawerOpen(false)} />
          <nav className="absolute inset-y-0 left-0 flex w-64 flex-col gap-5 overflow-y-auto border-r border-line bg-bg px-3 py-4">
            {sidebarBrand()}
            <SidebarSections sections={sections} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            {accountBlock}
          </nav>
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        {/* 桌面固定侧栏 */}
        <aside className="sticky top-0 hidden h-dvh flex-col gap-5 overflow-y-auto border-r border-line px-3 py-4 lg:flex">
          {sidebarBrand()}
          <SidebarSections sections={sections} pathname={pathname} />
          {accountBlock}
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-col">
          {/* 轻顶栏 */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur lg:px-8">
            <button
              type="button"
              aria-label="打开导航"
              onClick={() => setDrawerOpen(true)}
              className="rounded-md p-1 text-muted hover:bg-surface hover:text-accent lg:hidden"
            >
              <Icon name="menu" size={16} />
            </button>
            <span className="text-sm font-medium text-ink-2">{currentLabel ?? "relay"}</span>
            <div className="ml-auto flex items-center gap-3">
              {balanceLabel ? <span className="font-mono text-xs text-muted">{balanceLabel}</span> : null}
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
                aria-label="打开命令面板"
              >
                <Icon name="search" size={12} />
                <span className="hidden sm:inline">搜索</span>
                <kbd className="hidden sm:inline">⌘K</kbd>
              </button>
            </div>
          </header>

          {/* 内容区 */}
          <main className="page-shell flex-1 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
