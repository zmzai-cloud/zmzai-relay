"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

/**
 * 控制台/管理后台外壳 — AppShell 薄封装，保持旧 props 签名兼容（页面零改动）。
 * role="admin" 渲染管理组导航；isAdminUser 让 user 角色也能看到管理入口。
 */
export function RelayShell({ role, userName, isAdminUser = false, children }: { role: "admin" | "user"; userName: string; isAdminUser?: boolean; children: ReactNode }) {
  return (
    <AppShell user={{ name: userName }} isAdminUser={role === "admin" || isAdminUser}>
      {children}
    </AppShell>
  );
}
