"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useApp } from "./AppProvider";
import { Copilot } from "./Copilot";
import { Icon, type IconName } from "./ui";

type NavItem = { href: string; label: string; icon: IconName; match: (path: string) => boolean };

const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ href: "/", label: "Command Centre", icon: "home", match: (p) => p === "/" }] },
  {
    label: "Customers",
    items: [
      { href: "/customers", label: "Customer Directory", icon: "users", match: (p) => p === "/customers" },
      { href: "/insights", label: "Customer Insights", icon: "chart", match: (p) => p.startsWith("/insights") || p.startsWith("/customers/") },
    ],
  },
  {
    label: "Recovery",
    items: [
      { href: "/trial", label: "Recovery Decisions", icon: "scale", match: (p) => p.startsWith("/trial") },
      { href: "/studio", label: "Conversation Studio", icon: "message", match: (p) => p.startsWith("/studio") },
      { href: "/journeys", label: "Engagement & Journey", icon: "route", match: (p) => p.startsWith("/journeys") },
    ],
  },
  { label: "Performance", items: [{ href: "/impact", label: "Impact & Experiments", icon: "flask", match: (p) => p.startsWith("/impact") }] },
  {
    label: "Management",
    items: [
      { href: "/data", label: "Data & Integrations", icon: "database", match: (p) => p.startsWith("/data") },
      { href: "/responsible", label: "Responsible AI & Audit", icon: "shield", match: (p) => p.startsWith("/responsible") },
    ],
  },
];

/** The product workflow. Steps link to the page that performs them, carrying the active customer. */
const FLOW: { step: string; match: (p: string) => boolean; base: string; caseLink?: (id: string) => string; tip: string }[] = [
  { step: "Detect", match: (p) => p.startsWith("/customers") || p.startsWith("/insights"), base: "/customers", caseLink: (id) => `/insights?id=${id}`, tip: "Find customers whose buying habits changed" },
  { step: "Compare", match: (p) => p.startsWith("/trial"), base: "/trial", caseLink: (id) => `/trial?id=${id}`, tip: "Compare recovery actions against doing nothing" },
  { step: "Decide", match: (p) => p.startsWith("/trial"), base: "/trial", caseLink: (id) => `/trial?id=${id}`, tip: "Recover, Understand or Hold" },
  { step: "Converse", match: (p) => p.startsWith("/studio"), base: "/studio", caseLink: (id) => `/studio?id=${id}`, tip: "Review and approve the message" },
  { step: "Measure", match: (p) => p.startsWith("/impact"), base: "/impact", tip: "Compare customers who did and didn't receive the action" },
  { step: "Learn", match: (p) => p.startsWith("/impact"), base: "/impact", tip: "Update estimates with measured results" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { state, ready, storageOk, analysis } = useApp();
  const [open, setOpen] = useState(false);
  const caseId = ready && state.selectedCustomerId && analysis.byId[state.selectedCustomerId] ? state.selectedCustomerId : null;
  const inWorkflow = FLOW.some((f) => f.match(path));

  return (
    <div className="min-h-screen lg:flex">
      <aside className={`${open ? "block" : "hidden"} border-b border-line bg-shell lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r`}>
        <div className="hidden px-5 pb-5 pt-6 lg:block">
          <Brand />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
          {GROUPS.map((g) => (
            <div key={g.label} className="mb-5">
              <div className="px-2.5 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{g.label}</div>
              {g.items.map((n) => {
                const on = n.match(path);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    aria-current={on ? "page" : undefined}
                    className={`mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${on ? "bg-plum font-semibold text-plum-text" : "text-ink-soft hover:bg-surface-2 hover:text-ink"}`}
                  >
                    <Icon name={n.icon} className={`h-4 w-4 shrink-0 ${on ? "text-plum-accent" : "text-ink-faint"}`} />
                    {n.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        {ready && (
          <div className="space-y-1 border-t border-line px-5 py-4 text-xs text-ink-muted">
            <div className="font-medium text-ink-soft">{state.dataSource === "sample" ? "Demo mode · synthetic data" : state.dataSource === "upload" ? "Your uploaded data" : "No data loaded"}</div>
            <div>Data as of {state.asOf}</div>
            <Link href="/?guide=1" className="inline-block pt-1 font-medium text-plum-text underline decoration-line-strong underline-offset-4 hover:decoration-plum-accent">How REGAIN works</Link>
            {!storageOk && <div className="text-crimson-text" role="alert">Browser storage unavailable — changes won&apos;t be saved.</div>}
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-shell px-4 py-3 lg:hidden">
          <Brand />
          <button className="rounded-md border border-line-strong p-1.5 text-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Toggle navigation">
            <Icon name="menu" className="h-5 w-5" />
          </button>
        </header>

        {ready && (
          <div className="border-b border-line bg-surface">
            <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
              <ol className="flex flex-wrap items-center text-xs" aria-label="REGAIN workflow">
                {FLOW.map((f, i) => {
                  const on = inWorkflow && f.match(path);
                  const href = caseId && f.caseLink ? f.caseLink(caseId) : f.base;
                  return (
                    <li key={f.step} className="flex items-center">
                      <Link href={href} title={f.tip} aria-current={on ? "step" : undefined} className={`rounded px-1.5 py-0.5 transition-colors ${on ? "bg-plum font-semibold text-plum-text" : "text-ink-muted hover:text-ink"}`}>
                        {f.step}
                      </Link>
                      {i < FLOW.length - 1 && <span className="px-0.5 text-line-strong" aria-hidden="true">/</span>}
                    </li>
                  );
                })}
              </ol>
              {caseId && (
                <Link href={`/insights?id=${caseId}`} className="text-xs text-ink-muted transition-colors hover:text-ink" title="The customer you're working on — kept across pages">
                  Active case <span className="font-semibold text-ink">{caseId}</span>
                </Link>
              )}
            </div>
          </div>
        )}

        <main className="mx-auto max-w-[1240px] px-4 pb-24 pt-7 sm:px-6 lg:px-8 lg:pt-9">{children}</main>
      </div>
      <Copilot />

    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-xs font-bold text-white" aria-hidden="true">R</span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-ink">REGAIN</span>
        <span className="hidden text-2xs text-ink-muted lg:block">Retention Decision Engine</span>
      </span>
    </Link>
  );
}
