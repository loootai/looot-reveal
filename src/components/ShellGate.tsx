"use client";

import { usePathname } from "next/navigation";
import { AppShell, type AppShellProps } from "./AppShell";

/** Routes meant for the public. They render without the sidebar, so a visitor never sees the admin navigation. */
const PUBLIC_PREFIXES = ["/optout"];

/** The app shell, except on public pages such as the opt-out page. */
export function ShellGate(props: AppShellProps) {
  const path = usePathname();
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return <main className="mx-auto min-h-dvh max-w-xl px-4 py-10">{props.children}</main>;
  return <AppShell {...props} />;
}
