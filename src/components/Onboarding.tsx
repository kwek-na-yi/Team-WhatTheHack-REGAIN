"use client";
// First-time guide (dismissible, remembered per browser) and Demo Mode case picker.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ACTION_VERB } from "@/lib/present";
import type { TrialResult } from "@/lib/types";
import { useApp } from "./AppProvider";
import { Button, DecisionBadge, SyntheticTag } from "./ui";

const KEY = "regain:guide-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function WelcomeGuide() {
  const { state } = useApp();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get("guide") === "1";
    setShow(forced || !readDismissed());
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable: hide for this visit only */
    }
    setShow(false);
    if (window.location.search.includes("guide=1")) window.history.replaceState(null, "", "/");
  };
  const approved = Object.values(state.conversations).some((c) => c.sends > 0);
  const steps: { title: string; text: string; href: string; cta: string; done?: boolean }[] = [
    { title: "Add customer data", text: "Upload a transaction CSV, or use the demo dataset.", href: "/data#import", cta: "Upload customer data", done: state.transactions.length > 0 },
    { title: "Review customers", text: "See whose buying habits changed, and the evidence (Customer Directory).", href: "/customers?decision=act", cta: "Review customers" },
    { title: "Compare actions", text: "A message, fixing a problem, a discount — or doing nothing (Recovery Decisions).", href: "/trial", cta: "Compare recovery actions" },
    { title: "Approve the message", text: "Edit and approve the draft, then simulate the reply (Conversation Studio).", href: "/studio", cta: "Review message", done: approved },
    { title: "Measure results", text: "Compare customers who did and didn't get the action (Impact & Experiments).", href: "/impact", cta: "View results", done: state.experiments.length > 0 },
  ];
  return (
    <section aria-labelledby="guide-title" className="mb-7 rounded-lg border border-line border-l-2 border-l-plum-accent bg-surface shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 id="guide-title" className="text-[15px] font-semibold text-ink">How REGAIN works — five steps</h2>
          <p className="mt-0.5 text-sm text-ink-muted">REGAIN checks whether contacting a customer is worth it before suggesting what to say.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={dismiss}>Dismiss guide</Button>
      </div>
      <ol className="grid gap-x-6 gap-y-5 px-5 pb-5 pt-4 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col">
            <span className={`text-xs font-medium tabular-nums ${s.done ? "text-good" : "text-plum-accent"}`}>{s.done ? "Done" : `Step ${i + 1}`}</span>
            <span className="mt-1 text-sm font-medium text-ink">{s.title}</span>
            <span className="mt-1 flex-1 text-xs leading-relaxed text-ink-muted">{s.text}</span>
            <Link href={s.href} className="mt-2 text-xs font-semibold text-plum-text underline decoration-line-strong underline-offset-4 hover:decoration-plum-accent">{s.cta}</Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

type DemoCase = { title: string; teaches: string; t: TrialResult };

/** Contrasting cases picked from the engine's live decisions on the synthetic dataset. */
export function DemoCases() {
  const { state, analysis } = useApp();
  if (state.dataSource !== "sample") return null;
  const all = Object.values(analysis.trials).sort((a, b) => b.priorityScore - a.priorityScore || a.customerId.localeCompare(b.customerId));
  const find = (f: (t: TrialResult) => boolean) => all.find(f);
  const pick = (title: string, teaches: string, t: TrialResult | undefined): DemoCase | null => (t ? { title, teaches, t } : null);
  const cases = [
    pick("Recovery action", "A regular buyer is overdue — a reminder beats a discount.", find((t) => t.decision === "RECOVER" && t.recommendedAction === "reminder")),
    pick("Service problem", "A recorded complaint — fix it before any promotion.", find((t) => t.recommendedAction === "service_recovery")),
    pick("Unclear cause", "Buying slowed with no recorded reason — ask first.", find((t) => t.decision === "UNDERSTAND")),
    pick("Do nothing", "Buying as usual — contacting would waste money.", find((t) => t.decision === "HOLD" && !t.suppression && analysis.byId[t.customerId].status === "on_rhythm")),
    pick("Contact not allowed", "Opted out — REGAIN never drafts a message.", find((t) => t.suppression === "opted_out")),
  ].filter((c): c is DemoCase => c !== null);
  if (!cases.length) return null;
  return (
    <section aria-labelledby="demo-title" className="rounded-lg border border-line bg-surface shadow-card">
      <div className="px-5 pt-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="demo-title" className="text-[15px] font-semibold text-ink">Demo cases</h2>
          <SyntheticTag />
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">Five contrasting customers, chosen live from the engine&apos;s decisions — the same every time.</p>
      </div>
      <ul className="mt-2">
        {cases.map((c) => (
          <li key={c.title} className="border-t border-line first:border-t-0">
            <Link href={`/trial?id=${c.t.customerId}`} className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs text-ink-muted">{c.title}</span>
                  <DecisionBadge d={c.t.decision} />
                </span>
                <span className="block text-sm font-medium text-ink">{c.t.customerId} · {ACTION_VERB[c.t.recommendedAction]}</span>
                <span className="block text-xs text-ink-muted">{c.teaches}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-plum-text underline decoration-line-strong underline-offset-4 group-hover:decoration-plum-accent">Open case</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
