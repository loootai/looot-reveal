import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellNavSection } from "@/components/AppShell";
import { getView } from "@/lib/app";
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

const NAV: ShellNavSection[] = [
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
      { href: "/privacy", label: "Privacy and retention", icon: "scroll" },
      { href: "/costs", label: "Costs", icon: "receipt" },
      { href: "/settings", label: "Config file", icon: "settings" },
    ],
  },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const v = await getView();
  const cap = Math.round(v.config.spendCapUsd * 1_000_000);
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <AppShell
          appName="looot-reveal"
          nav={NAV}
          githubHref="https://github.com/loootai/looot-reveal"
          demoLabel={v.demo ? "Demo data" : undefined}
          spend={{ label: `Spent in total, ${usd(cap)} cap per run`, spent: usd(v.spentMicros) }}
          primaryAction={{ href: "/import", label: "Import visits" }}
        >
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">{children}</div>
        </AppShell>
      </body>
    </html>
  );
}
