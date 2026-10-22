// Presentation helpers: plain-language labels and definitions derived from engine output.
// No business logic lives here — only wording.
import type { ActionId, CustomerProfile, Decision, TrialResult } from "./types";

/** Imperative label for the recommended action. */
export const ACTION_VERB: Record<ActionId, string> = {
  check_in: "Send a helpful check-in",
  reminder: "Send a replenishment reminder",
  service_recovery: "Fix the service problem first",
  benefit: "Offer a non-monetary thank-you",
  discount: "Offer a discount",
  no_action: "Do nothing for now",
};

export const ACTION_SHORT: Record<ActionId, string> = {
  no_action: "No action",
  check_in: "Check-in",
  reminder: "Reminder",
  service_recovery: "Service recovery",
  benefit: "Benefit",
  discount: "Discount",
};

/** The three decision outcomes, in plain English. */
export const DECISION_DEF: Record<Decision, { title: string; line: string }> = {
  RECOVER: { title: "Recover", line: "Act — the evidence and the numbers support a recovery action." },
  UNDERSTAND: { title: "Understand", line: "Ask first — buying slowed, but the data doesn't show why." },
  HOLD: { title: "Hold", line: "Do nothing for now — not enough evidence, not worth the cost, or contact isn't allowed." },
};

export const DECISION_HINT: Record<Decision, string> = {
  RECOVER: "Act — the cause is evidenced",
  UNDERSTAND: "Ask first — the cause is unclear",
  HOLD: "Do nothing for now",
};

/** One-sentence definitions shown in tooltips next to metrics. */
export const GLOSSARY = {
  daysSince: "How many days have passed since this customer last bought something.",
  usualGap: "The typical number of days between this customer's purchases (the median gap).",
  vsRhythm: "Days since last purchase divided by the usual gap. 2× means twice as long as usual.",
  extraContribution:
    "Estimated additional money earned after the relevant costs of this recovery action, compared with doing nothing. Uses margin, not revenue; fixed overheads are not included.",
  repeatRate: "The percentage of customers who purchased again during the selected period.",
  difference: "The difference in repeat-purchase rates between the two groups. On its own this does not prove the action caused the difference.",
  interval: "The range of differences that are consistent with the data (95% confidence interval). If it includes zero, the action may have had no effect.",
  evidence: "How much purchase history supports this recommendation. It measures data, not the chance of success.",
  needAttention: "Customers REGAIN recommends acting on (Recover) or asking first (Understand).",
  cost: "Expected cost of the action: message or staff time, any discount or benefit, and the risk of an opt-out.",
  pValue: "How surprising the difference would be if the action had no effect. Small values (below 0.05) make chance a less likely explanation.",
  leakage: "Discount paid to customers who would probably have bought anyway.",
} as const;

/** One-line behavioural signal for tables and lists. */
export function signalText(p: CustomerProfile): string {
  const issue = p.openServiceIssue ? " · open complaint" : "";
  if (p.rhythmSource === "population") return `${p.orderCount} purchase · ${p.recencyDays} days ago${issue}`;
  const usual = Math.round(p.medianInterval as number);
  if (p.status === "on_rhythm") return `Buying as usual · ${p.recencyDays} of usual ${usual} days${issue}`;
  return `${p.recencyDays} days since last purchase · usually ${usual}${issue}`;
}

/** Plain-English confidence statement from evidence quality. */
export function certaintyText(p: CustomerProfile): { label: string; line: string } {
  if (p.evidenceLevel === "high") return { label: "Strong history", line: "Plenty of purchase history. The value still depends on the estimates shown." };
  if (p.evidenceLevel === "medium") return { label: "Some evidence", line: "A reasonable history, but the estimate could be well off." };
  return { label: "Limited evidence", line: "Little history — this estimate depends heavily on the assumptions shown." };
}

/** The single most important reason, without the decision prefix. */
export function mainReason(t: TrialResult): string {
  return t.reasons[0] ?? "";
}

/** Short reason for HOLD decisions (engine headline without the prefix). */
export function holdReason(t: TrialResult): string {
  const s = t.headline.replace(/^HOLD — /, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
