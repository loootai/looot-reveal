import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ShellNavSection, ShellSpend, ShellSpendRow } from "@/components/AppShell";
import { ShellGate } from "@/components/ShellGate";
import { budgetStatus, getView } from "@/lib/app";
import type { PeriodStatus } from "@/lib/budget";
import { currentCsrf, requireAdminPage } from "@/lib/auth/guard";
import { isPublicPath } from "@/lib/auth/routes";
import { usd } from "@/lib/money";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "looot-reveal", template: "%s · looot-reveal" },
  description: "Open-source website visitor to company lookup. IP address in, company out, with an ICP flag. Built on looot.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

const BASE_NAV: ShellNavSection[] = [
  {
    heading: "Visitors",
    items: [
      { href: "/", label: "Feed", icon: "radar", also: ["/company"] },
      { href: "/sources", label: "Sources and snippet", icon: "rss" },
      { href: "/import", label: "Import and run", icon: "inbox" },
    ],
  },
  {
    heading: "Setup",
    items: [
      { href: "/waterfall", label: "Provider waterfall", icon: "layers" },
      { href: "/icp", label: "ICP", icon: "target" },
      { href: "/person-setup", label: "Person-level (optional)", icon: "users" },
      { href: "/privacy", label: "Privacy and retention", icon: "scroll" },
      { href: "/costs", label: "Costs", icon: "receipt" },
      { href: "/settings", label: "Config file", icon: "settings" },
    ],
  },
];

/** The People section shows only when person-level identification is on. The company feed stays the first item either way. */
const PEOPLE_NAV: ShellNavSection = {
  heading: "People (US only)",
  items: [
    { href: "/people", label: "People", icon: "users" },
    { href: "/suppression", label: "Suppression and opt-out", icon: "bell" },
    { href: "/audit", label: "Audit log", icon: "list" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-reveal-path") ?? "";
  // Public routes (sign-in, opt-out) render with no stored data and no admin navigation.
  if (path !== "" && isPublicPath(path)) {
    return (
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body className="min-h-dvh bg-page text-ink">
          <main className="mx-auto min-h-dvh max-w-xl px-4 py-10">{children}</main>
        </body>
      </html>
    );
  }
  const gate = await requireAdminPage();
  const csrf = await currentCsrf();
  const v = await getView();
  const b = await budgetStatus();
  const row = (label: string, p: PeriodStatus): ShellSpendRow => ({ label, used: usd(p.usedMicros), reserved: usd(p.reservedMicros), remaining: usd(p.remainingMicros), cap: usd(p.limitMicros), ratio: p.limitMicros > 0 ? (p.usedMicros + p.reservedMicros) / p.limitMicros : 0 });
  const spend: ShellSpend = { title: "Spend budget", rows: [row("Today", b.day), row("Month", b.month)], note: b.remainingMicros <= 0 ? "Budget reached. Paid runs are refused." : undefined };
  const nav = v.person.active ? [BASE_NAV[0], PEOPLE_NAV, ...BASE_NAV.slice(1)] : BASE_NAV;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <meta name="reveal-csrf" content={csrf} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <ShellGate
          appName="looot-reveal"
          nav={nav}
          githubHref="https://github.com/loootai/looot-reveal"
          demoLabel={gate.policy.mode === "open-demo" ? "Demo, no sign-in" : v.demo ? "Demo data" : undefined}
          signOut={gate.policy.mode === "login"}
          spend={spend}
          primaryAction={{ href: "/import", label: "Import visits" }}
        >
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">{children}</div>
        </ShellGate>
      </body>
    </html>
  );
}
