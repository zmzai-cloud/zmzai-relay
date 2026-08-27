"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Icon, Navbar } from "@zmzai/theme";
import type { IconName } from "@zmzai/theme";
import { LogoutButton } from "@/components/logout-button";

type NavLeaf = { label: string; href: string; icon?: IconName };
type NavGroup = { label: string; icon: IconName; defaultHref: string; children: NavLeaf[] };
type NavNode = NavLeaf | NavGroup;

const adminLinks: Array<[string, string, IconName]> = [["概览", "/admin", "home"], ["模型与价格", "/admin/models", "grid"], ["渠道与路由", "/admin/channels", "link"], ["用户与余额", "/admin/users", "users"], ["运营调整", "/admin/operations", "sliders"], ["毛利报表", "/admin/profit", "trend-up"], ["充值订单", "/admin/orders", "receipt"], ["调用与账本", "/admin/activity", "activity"], ["全部 Token", "/admin/keys", "key"]] as const;

const userNav: NavNode[] = [
  { label: "概览", href: "/dashboard", icon: "home" },
  { label: "API Keys", href: "/dashboard/keys", icon: "key" },
  {
    label: "用量与账单",
    icon: "activity",
    defaultHref: "/dashboard/activity",
    children: [
      { label: "用量", href: "/dashboard/activity" },
      { label: "账单", href: "/dashboard/ledger" },
    ],
  },
  { label: "额度充值", href: "/dashboard/billing", icon: "wallet" },
  { label: "API 文档", href: "/docs", icon: "book" },
];

function isGroup(node: NavNode): node is NavGroup {
  return (node as NavGroup).children !== undefined;
}

function NavLeafLink({ node, pathname, indent = false }: { node: NavLeaf; pathname: string; indent?: boolean }) {
  const active = pathname === node.href;
  return (
    <Link
      href={node.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md py-1.5 transition-colors hover:text-accent ${indent ? "pl-7" : ""} ${
        active ? "font-medium text-accent-readable" : "text-muted"
      }`}
    >
      {node.icon ? <Icon name={node.icon} size={13} /> : null}
      {node.label}
    </Link>
  );
}

function NavNodeItem({ node, pathname }: { node: NavNode; pathname: string }) {
  if (!isGroup(node)) return <NavLeafLink node={node} pathname={pathname} />;
  const childActive = node.children.some((c) => pathname === c.href);
  return (
    <div>
      <Link
        href={node.defaultHref}
        aria-current={childActive ? "page" : undefined}
        className={`flex items-center justify-between gap-2 rounded-md py-1.5 transition-colors hover:text-accent ${
          childActive ? "font-medium text-accent-readable" : "text-muted"
        }`}
      >
        <span className="flex items-center gap-2">
          <Icon name={node.icon} size={13} />
          {node.label}
        </span>
        <Icon name={childActive ? "chevron-down" : "chevron-right"} size={12} />
      </Link>
      {childActive && (
        <div className="mt-1 flex flex-col gap-0.5">
          {node.children.map((c) => (
            <NavLeafLink key={c.href} node={c} pathname={pathname} indent />
          ))}
        </div>
      )}
    </div>
  );
}

export function RelayShell({ role, userName, isAdminUser = false, children }: { role: "admin" | "user"; userName: string; isAdminUser?: boolean; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const nav = role === "admin" ? adminLinks : userNav;
  return (
    <main className="min-h-dvh bg-bg">
      <Navbar
        sublabel="relay"
        brandHref="/"
        badge={<span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-3">m.zmzai.cloud</span>}
        actions={
          <>
            <span className="font-mono text-xs text-muted">{userName}</span>
            {role === "admin" ? (
              <Link href="/dashboard" className="flex items-center gap-1.5 font-mono text-xs text-muted hover:text-accent">
                <Icon name="chevron-right" size={12} />
                用户端
              </Link>
            ) : isAdminUser ? (
              <Link href="/admin" className="flex items-center gap-1.5 font-mono text-xs text-muted hover:text-accent">
                <Icon name="settings" size={12} />
                管理后台
              </Link>
            ) : null}
            <LogoutButton />
          </>
        }
      />
      <div className="page-shell grid gap-8 py-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav className="flex gap-4 overflow-x-auto border-b border-line pb-3 font-mono text-xs text-muted lg:flex-col lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
          {role === "admin"
            ? adminLinks.map(([label, href, icon]) => (
                <NavLeafLink key={href} node={{ label, href, icon }} pathname={pathname} />
              ))
            : userNav.map((node) => <NavNodeItem key={node.label} node={node} pathname={pathname} />)}
        </nav>
        <section className="min-w-0">{children}</section>
      </div>
    </main>
  );
}
