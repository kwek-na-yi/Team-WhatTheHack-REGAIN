// Customer Insights overview metrics. Pure functions over the engine's own output (profiles with
// grouped orders, Recovery Trial results, contact-policy suppression, experiments). No new economics:
// estimated values come from runTrial, measured values from computeImpact / analyseHistorical.
import type { Analysis } from "./analysis";
import type { ConversationState, ResponseKind } from "./conversation";
import { analyseHistorical, computeImpact, type Experiment } from "./experiment";
import type { CustomerProfile, Decision, InterventionRecord, TrialResult } from "./types";
import { addDays, daysBetween } from "./utils";

/* ------------------------------------------------------------ purchase trend */

export type TrendRange = "3m" | "6m" | "12m" | "all";
export type TrendMetric = "orders" | "revenue";

export interface TrendPoint {
  /** First day of the period (inclusive). */
  start: string;
  /** Last day of the period (inclusive; never after the analysis date). */
  end: string;
  label: string;
  orders: number;
  revenue: number;
  /** Distinct customers who ordered in the period. */
  customers: number;
  /** The calendar month containing the analysis date, which is not over yet. */
  partial: boolean;
}

export interface Trend {
  grain: "week" | "month";
  from: string;
  to: string;
  points: TrendPoint[];
  orders: number;
  revenue: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
function nextMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
function monthsBack(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
}

/**
 * Orders and revenue per period, from orders already grouped by `groupOrders` (one order = one
 * order ID, its lines summed). 3 and 6 months use 7-day periods ending on the analysis date, so
 * every period is complete; 12 months and "all" use calendar months, and the current month is
 * flagged as partial. Empty periods are kept as zero. Orders after the analysis date are ignored.
 */
export function purchaseTrend(profiles: CustomerProfile[], asOf: string, range: TrendRange): Trend {
  const buckets: TrendPoint[] = [];
  if (range === "3m" || range === "6m") {
    const weeks = range === "3m" ? 13 : 26;
    for (let i = weeks - 1; i >= 0; i--) {
      const end = addDays(asOf, -7 * i);
      buckets.push({ start: addDays(end, -6), end, label: dayLabel(end), orders: 0, revenue: 0, customers: 0, partial: false });
    }
  } else {
    let first = monthsBack(asOf, 11);
    if (range === "all") {
      const dates = profiles.flatMap((p) => p.orders.map((o) => o.date)).filter((d) => d <= asOf);
      if (!dates.length) return { grain: "month", from: asOf, to: asOf, points: [], orders: 0, revenue: 0 };
      first = monthStart(dates.reduce((a, b) => (a < b ? a : b)));
    }
    for (let s = first; s <= asOf; s = nextMonth(s)) {
      const lastDay = addDays(nextMonth(s), -1);
      buckets.push({ start: s, end: lastDay < asOf ? lastDay : asOf, label: monthLabel(s), orders: 0, revenue: 0, customers: 0, partial: lastDay > asOf });
    }
  }
  const from = buckets[0].start;
  const who = buckets.map(() => new Set<string>());
  for (const p of profiles)
    for (const o of p.orders) {
      if (o.date < from || o.date > asOf) continue;
      const i = buckets.findIndex((b) => o.date >= b.start && o.date <= b.end);
      if (i < 0) continue;
      buckets[i].orders++;
      buckets[i].revenue += o.value;
      who[i].add(p.customerId);
    }
  buckets.forEach((b, i) => {
    b.revenue = Math.round(b.revenue * 100) / 100;
    b.customers = who[i].size;
  });
  return {
    grain: range === "3m" || range === "6m" ? "week" : "month",
    from,
    to: asOf,
    points: buckets,
    orders: buckets.reduce((s, b) => s + b.orders, 0),
    revenue: Math.round(buckets.reduce((s, b) => s + b.revenue, 0) * 100) / 100,
  };
}

/** Average order value over a trend's period: total order value ÷ number of orders. Null with no orders. */
export function averageOrderValue(t: Pick<Trend, "orders" | "revenue">): number | null {
  return t.orders ? t.revenue / t.orders : null;
}

/* ------------------------------------------------------- repeat-purchase rate */

export const REPEAT_WINDOW_DAYS = 90;

export interface RepeatRate {
  windowDays: number;
  /** Customers whose first purchase was at least `windowDays` before the analysis date. */
  eligible: number;
  /** Of those, customers with another order on a later day within `windowDays` of the first. */
  repeated: number;
  rate: number | null;
  /** Customers whose window is still open — excluded, never counted as success or failure. */
  stillOpen: number;
}

/**
 * W-day repeat-purchase rate after a customer's first purchase. Eligible: first purchase on or before
 * (analysis date − W), so every eligible customer had the full window. A repeat is an order on a LATER
 * day than the first purchase and no more than W days after it (a second basket on the same day is the
 * same visit). Customers whose window is still open are reported separately and excluded.
 */
export function repeatPurchaseRate(profiles: CustomerProfile[], asOf: string, windowDays = REPEAT_WINDOW_DAYS): RepeatRate {
  let eligible = 0, repeated = 0, stillOpen = 0;
  for (const p of profiles) {
    const first = p.orders[0]?.date;
    if (!first || first > asOf) continue;
    if (daysBetween(first, asOf) < windowDays) {
      stillOpen++;
      continue;
    }
    eligible++;
    const limit = addDays(first, windowDays);
    if (p.orders.some((o) => o.date > first && o.date <= limit)) repeated++;
  }
  return { windowDays, eligible, repeated, rate: eligible ? repeated / eligible : null, stillOpen };
}

/* ------------------------------------------------------- priority customers */

export interface ContactStatus {
  /** True only when consent, opt-out, decline and frequency rules all allow marketing contact. */
  allowed: boolean;
  label: string;
}

/** Contact eligibility exactly as the contact policy decided it for this customer's Recovery Trial. */
export function contactStatus(t: TrialResult, p: Pick<CustomerProfile, "marketingConsent">): ContactStatus {
  switch (t.suppression) {
    case "opted_out": return { allowed: false, label: "Opted out" };
    case "no_consent": return { allowed: false, label: p.marketingConsent === "no" ? "No consent" : "Consent not recorded" };
    case "frequency_cap": return { allowed: false, label: "Contact limit reached" };
    case "declined": return { allowed: false, label: "Declined — paused" };
    default: return { allowed: true, label: "Allowed" };
  }
}

export type PriorityFilter = "attention" | "all" | Decision;

/**
 * Customers in REGAIN's established priority order: Recover / Understand before Hold, then by the
 * estimated incremental contribution of the recommended action (the trial's priorityScore), then ID.
 * Historical spend plays no part in the ranking.
 */
export function priorityIds(a: Analysis, filter: PriorityFilter = "attention", query = ""): string[] {
  const q = query.trim().toLowerCase();
  return a.profiles
    .map((p) => p.customerId)
    .filter((id) => {
      const d = a.trials[id].decision;
      if (filter === "attention" && d === "HOLD") return false;
      if (filter !== "attention" && filter !== "all" && d !== filter) return false;
      return !q || id.toLowerCase().includes(q);
    })
    .sort((x, y) => {
      const tx = a.trials[x], ty = a.trials[y];
      return Number(tx.decision === "HOLD") - Number(ty.decision === "HOLD") || ty.priorityScore - tx.priorityScore || x.localeCompare(y);
    });
}

/* ------------------------------------------------------ conversation journey */

export interface JourneyStage {
  key: "attention" | "drafted" | "approved" | "replied";
  label: string;
  count: number;
  /** Share of the previous stage — only where this stage is a strict subset of it. */
  shareOfPrevious: number | null;
  simulated: boolean;
  help: string;
  href: string;
}

export interface OutcomeCounts {
  /** Experiment members with a recorded outcome, by source. */
  observed: { recorded: number; purchased: number };
  simulated: { recorded: number; purchased: number };
  /** Outcome not yet known — excluded, never counted as a success or failure. */
  pending: number;
  experiments: number;
}

export interface Journey {
  stages: JourneyStage[];
  replies: Partial<Record<ResponseKind, number>>;
  outcomes: OutcomeCounts;
}

/** Built only from records that exist: current decisions, Studio conversations and experiment outcomes. */
export function conversationJourney(a: Analysis, conversations: Record<string, ConversationState>, experiments: Experiment[]): Journey {
  const convs = Object.values(conversations).filter((c) => a.byId[c.customerId]);
  const approved = convs.filter((c) => c.sends > 0);
  const replied = approved.filter((c) => c.lastResponse);
  const share = (n: number, base: number) => (base ? n / base : null);
  const replies: Journey["replies"] = {};
  for (const c of replied) replies[c.lastResponse as ResponseKind] = (replies[c.lastResponse as ResponseKind] ?? 0) + 1;
  const outcomes: OutcomeCounts = { observed: { recorded: 0, purchased: 0 }, simulated: { recorded: 0, purchased: 0 }, pending: 0, experiments: experiments.length };
  for (const e of experiments)
    for (const m of e.members) {
      const o = e.outcomes[m.customerId];
      if (!o || o.purchased === null) {
        outcomes.pending++;
        continue;
      }
      const bucket = o.source === "simulated" ? outcomes.simulated : outcomes.observed;
      bucket.recorded++;
      if (o.purchased) bucket.purchased++;
    }
  return {
    stages: [
      { key: "attention", label: "Needs attention now", count: a.counts.RECOVER + a.counts.UNDERSTAND, shareOfPrevious: null, simulated: false, help: "Recover or Understand decisions today. Every one is allowed to be contacted under the consent and contact rules.", href: "/insights#priority" },
      // Not a subset of the stage above: a customer drafted earlier may be on Hold today (e.g. contact limit).
      { key: "drafted", label: "Message drafted", count: convs.length, shareOfPrevious: null, simulated: false, help: "Customers with a draft in Conversation Studio. Not a share of the stage above: someone drafted earlier can be on Hold now.", href: "/studio" },
      { key: "approved", label: "Approved · simulated send", count: approved.length, shareOfPrevious: share(approved.length, convs.length), simulated: true, help: "Drafts a person reviewed and approved. The send is simulated — nothing was delivered.", href: "/studio" },
      { key: "replied", label: "Simulated reply recorded", count: replied.length, shareOfPrevious: share(replied.length, approved.length), simulated: true, help: "A scripted customer reply chosen in the Studio. Not real customer engagement.", href: "/studio" },
    ],
    replies,
    outcomes,
  };
}

/* --------------------------------------------------- incremental contribution */

export type ContributionResult =
  | { kind: "experiment"; title: string; value: number; simulated: boolean; diffPp: number; ci: [number, number]; treatmentN: number; controlN: number; pending: number }
  | { kind: "imported"; title: string; diffPp: number; ci: [number, number]; treatmentN: number; controlN: number }
  | { kind: "none" };

/** Latest experiment with recorded outcomes (via computeImpact), else the imported campaign comparison. */
export function latestContribution(experiments: Experiment[], interventions: InterventionRecord[]): ContributionResult {
  for (const e of experiments) {
    const m = computeImpact(e);
    if (!m.treatment.observed || !m.control.observed) continue;
    return { kind: "experiment", title: `${e.id} · ${e.name}`, value: m.incrementalContribution, simulated: m.sources.includes("simulated"), diffPp: m.diffPp, ci: m.diffCi, treatmentN: m.treatment.observed, controlN: m.control.observed, pending: m.treatment.pending + m.control.pending };
  }
  const h = analyseHistorical(interventions)[0];
  if (h) return { kind: "imported", title: h.campaign, diffPp: h.diffPp, ci: h.diffCi, treatmentN: h.treatment.n, controlN: h.control.n };
  return { kind: "none" };
}

/* ------------------------------------------------------- profile: what it means */

const SLOWER = 1.25; // same threshold as the "slipping" status

/** Plain-English reading of one customer's record. Compares the customer only with their own history,
 * and never infers a reason (or dissatisfaction) from inactivity. */
export function whatThisMeans(p: CustomerProfile, t: TrialResult): string[] {
  const out: string[] = [];
  const personal = p.rhythmSource !== "population";
  let changed = false;
  if (!personal) {
    out.push(`This customer has bought only once (${p.lastOrderDate}), ${p.recencyDays} days ago, so REGAIN can't yet tell what their usual buying pattern is.`);
  } else {
    const usual = Math.round(p.medianInterval as number);
    const basis = p.rhythmSource === "provisional" ? "based on a single gap between purchases, so this is provisional" : `the median of ${p.intervals.length} gaps between their own purchases`;
    out.push(`This customer usually purchases every ${usual} days (${basis}). They have bought ${p.orderCount} times since ${monthLabel(p.firstOrderDate)}.`);
    const r = p.overdueRatio as number;
    changed = r >= SLOWER;
    out.push(
      changed
        ? `Their latest purchase was ${p.recencyDays} days ago, so the current gap is longer than usual — about ${r}× their usual gap.`
        : `Their latest purchase was ${p.recencyDays} days ago, which is within their usual pattern.`,
    );
  }
  if (p.spendTrend !== null && Math.abs(p.spendTrend) >= 0.1)
    out.push(`Spending in the last 6 months is ${Math.abs(Math.round(p.spendTrend * 100))}% ${p.spendTrend < 0 ? "lower" : "higher"} than in the 6 months before.`);
  if (p.openServiceIssue) out.push(`An unresolved service interaction is recorded: “${p.openServiceIssue.issue}” (${p.openServiceIssue.date}). It may be relevant, but the data doesn't show whether it caused any change.`);
  else out.push(p.resolvedServiceIssues ? `No unresolved service interaction is recorded (${p.resolvedServiceIssues} earlier issue${p.resolvedServiceIssues === 1 ? " was" : "s were"} marked resolved).` : "No service interaction is recorded.");
  out.push(
    !personal
      ? "With one purchase there isn't enough history to say whether anything has changed."
      : changed
        ? "The data shows a change in buying behaviour, but it cannot establish why the customer has not returned."
        : "Nothing in the purchase data suggests a change in buying behaviour.",
  );
  const c = contactStatus(t, p);
  out.push(c.allowed ? "Marketing contact is allowed under the consent and contact rules." : `Marketing contact is not allowed (${c.label.toLowerCase()}), so REGAIN will not recommend outreach.`);
  return out;
}
