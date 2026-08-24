"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button, Navbar, navItemClass } from "@zmzai/theme";
import { LogoutButton } from "@/components/logout-button";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "https://auth.zmzai.cloud";

/**
 * 公开区统一外壳：Navbar（模型/API 文档）+ 内容 + 极简 footer。
 * 与控制台（RelayShell）共用同一个 Navbar，全站只有一种顶栏语言。
 */
export function PublicShell({
  user,
  isAdminUser = false,
  children,
}: {
  user?: { name: string } | null;
  isAdminUser?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <Navbar
        sublabel="relay"
        brandHref="/"
        mobileMenu
        badge={<span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-3">m.zmzai.cloud</span>}
        actions={
          user ? (
            <>
              <span className="font-mono text-xs text-muted">{user.name}</span>
              <Link href={isAdminUser ? "/admin" : "/dashboard"}>
                <Button size="sm">进入控制台</Button>
              </Link>
              <LogoutButton />
            </>
          ) : (
            <Link href={`${AUTH_URL}/login?next=${encodeURIComponent("https://m.zmzai.cloud/dashboard")}`}>
              <Button size="sm">登录</Button>
            </Link>
          )
        }
      >
        <Link href="/models" className={navItemClass(pathname.startsWith("/models"))}>模型</Link>
        <Link href="/docs" className={navItemClass(pathname.startsWith("/docs"))}>API 文档</Link>
      </Navbar>
      {/* 不加 w-full：utilities 层会覆盖 .page-shell（components 层）的限宽，导致内容贴边 */}
      <main className="page-shell flex-1 py-10">{children}</main>
      <footer className="border-t border-line">
        <div className="page-shell flex items-center justify-between py-6 font-mono text-xs text-muted">
          <span>relay · zmzai.cloud</span>
          <Link href="https://zmzai.cloud" className="hover:text-accent">产品矩阵 →</Link>
        </div>
      </footer>
    </div>
  );
}
