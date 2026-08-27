"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

/**
 * 公开区外壳 — AppShell 薄封装，保持旧 props 签名兼容（页面零改动）。
 * 公开页与控制台共用同一 sidebar 框架，登录后多出控制台导航。
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
  return (
    <AppShell user={user} isAdminUser={isAdminUser}>
      {children}
    </AppShell>
  );
}
