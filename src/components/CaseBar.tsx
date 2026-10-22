"use client";
// The customer case: where one customer is in the DETECT → … → MEASURE journey.
// Every stage is derived from real app state (decision, conversation, experiment outcomes).
import Link from "next/link";
import { STATUS_LABEL as CONV_STATUS } from "@/lib/conversation";
import { ACTION_SHORT } from "@/lib/present";
import { useApp } from "./AppProvider";

type Stage = { label: string; value: string; href: string; state: "done" | "current" | "todo" | "skip" };

const STATUS_SHORT = {
  on_rhythm: "Buying as usual",
  slipping: "Slipping",
  lapsed: "Lapsed",
  dormant: "Dormant",
  new: "New customer",
  insufficient_history: "Too little history",
} as const;

export function CaseBar({ customerId }: { customerId: string }) {
  const { state, analysis } = useApp();
  const p = analysis.byId[customerId];
  const t = analysis.trials[customerId];
  if (!p || !t) return null;
  const conv = state.conversations[customerId];
  const exp = state.experiments.find((e) => e.members.some((m) => m.customerId === customerId));
  const member = exp?.members.find((m) => m.customerId === customerId);
  const outcome = exp?.outcomes[customerId];
  const hold = t.decision === "HOLD";

  const stages: Stage[] = [
    { label: "Detected", value: STATUS_SHORT[p.status], href: `/insights?id=${customerId}`, state: "done" },
    { label: "Decided", value: hold ? "Hold" : `${t.decision === "RECOVER" ? "Recover" : "Understand"} · ${ACTION_SHORT[t.recommendedAction]}`, href: `/trial?id=${customerId}`, state: "done" },
    {
      label: "Conversation",
      value: conv ? CONV_STATUS[conv.status] : hold ? "Not needed" : "Not started",
      href: `/studio?id=${customerId}`,
      state: conv ? (conv.status === "closed" || conv.status === "escalated" ? "done" : "current") : hold ? "skip" : "current",
    },
    {
      label: "Outcome",
      value: !exp
        ? "Not measured"
        : member?.group === "control"
          ? `Holdout in ${exp.id}`
          : !outcome || outcome.purchased === null
            ? `Pending in ${exp.id}`
            : `${outcome.purchased ? "Purchased" : "No purchase"}${outcome.source === "simulated" ? " (simulated)" : ""}`,
      href: "/impact",
      state: outcome && outcome.purchased !== null ? "done" : exp ? "current" : "todo",
    },
  ];

  return (
    <nav aria-label={`Case progress for ${customerId}`} className="mb-7 grid grid-cols-2 gap-4 md:grid-cols-4">
      {stages.map((s) => (
        <Link key={s.label} href={s.href} className="group block">
          <span className={`block h-0.5 w-full rounded-full ${s.state === "done" ? "bg-plum-accent" : s.state === "current" ? "bg-ink-faint" : "bg-line-strong"}`} aria-hidden="true" />
          <span className="mt-2.5 block text-2xs font-medium uppercase tracking-wider text-ink-faint">{s.label}</span>
          <span className={`block truncate text-sm group-hover:text-ink ${s.state === "todo" || s.state === "skip" ? "text-ink-muted" : "text-ink-soft"}`}>{s.value}</span>
        </Link>
      ))}
    </nav>
  );
}
