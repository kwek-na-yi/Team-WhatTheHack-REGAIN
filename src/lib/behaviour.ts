// Customer behavioural intelligence. Every number here is a transparent calculation over the
// customer's own order history — no model training, no hidden weights.
import type { BehaviourStatus, CustomerProfile, EvidenceItem, Order, Transaction, YesNoUnknown } from "./types";
import { addDays, clamp, daysBetween, mad, mean, median, round } from "./utils";

export const DEFAULT_POPULATION_INTERVAL = 45;

/** Thresholds on overdueRatio = days since last order / usual interval. */
export const STATUS_THRESHOLDS = { slipping: 1.25, lapsed: 2, dormant: 4 } as const;

export const STATUS_LABEL: Record<BehaviourStatus, string> = {
  on_rhythm: "On rhythm",
  slipping: "Slipping",
  lapsed: "Lapsed",
  dormant: "Dormant",
  new: "New (1 order)",
  insufficient_history: "Insufficient history",
};

export function groupOrders(txns: Transaction[]): Order[] {
  const byOrder = new Map<string, Order>();
  for (const t of txns) {
    const o = byOrder.get(t.orderId);
    if (!o) {
      byOrder.set(t.orderId, {
        orderId: t.orderId,
        date: t.date,
        value: t.value,
        categories: [t.category],
        serviceIssue: t.serviceIssue,
        serviceIssueResolved: t.serviceIssueResolved,
      });
    } else {
      o.value = round(o.value + t.value, 2);
      if (t.date < o.date) o.date = t.date;
      if (!o.categories.includes(t.category)) o.categories.push(t.category);
      if (t.serviceIssue && !o.serviceIssue) {
        o.serviceIssue = t.serviceIssue;
        o.serviceIssueResolved = t.serviceIssueResolved;
      }
    }
  }
  return [...byOrder.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.orderId.localeCompare(b.orderId)));
}

/** Gaps in days between distinct purchase dates (same-day orders count as one visit). */
export function purchaseIntervals(orders: Order[]): number[] {
  const dates = [...new Set(orders.map((o) => o.date))].sort();
  const out: number[] = [];
  for (let i = 1; i < dates.length; i++) out.push(daysBetween(dates[i - 1], dates[i]));
  return out;
}

/** Robust spread of intervals with a floor so that very regular customers are not flagged on a 1-day slip. */
export function robustScale(intervals: number[]): number | null {
  const m = median(intervals);
  const d = mad(intervals);
  if (m === null || d === null) return null;
  return Math.max(1.4826 * d, 0.2 * m, 3);
}

export function classifyStatus(overdueRatio: number): BehaviourStatus {
  if (overdueRatio < STATUS_THRESHOLDS.slipping) return "on_rhythm";
  if (overdueRatio < STATUS_THRESHOLDS.lapsed) return "slipping";
  if (overdueRatio < STATUS_THRESHOLDS.dormant) return "lapsed";
  return "dormant";
}

function latestKnown(txns: Transaction[], key: "marketingConsent" | "optedOut"): YesNoUnknown {
  const sorted = [...txns].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const t of sorted) {
    const v = t[key];
    if (v && v !== "unknown") return v;
  }
  return "unknown";
}

export function populationInterval(profilesMedians: number[]): number {
  return median(profilesMedians) ?? DEFAULT_POPULATION_INTERVAL;
}

export interface BuildOptions {
  asOf: string;
  populationIntervalOverride?: number;
}

export function buildProfiles(txns: Transaction[], opts: BuildOptions): CustomerProfile[] {
  const { asOf } = opts;
  const byCustomer = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.date > asOf) continue; // never use data from after the analysis date
    const arr = byCustomer.get(t.customerId);
    if (arr) arr.push(t);
    else byCustomer.set(t.customerId, [t]);
  }
  // Population rhythm: median of personal medians for customers with >= 3 visits.
  const personalMedians: number[] = [];
  const grouped = new Map<string, Order[]>();
  for (const [id, list] of byCustomer) {
    const orders = groupOrders(list);
    grouped.set(id, orders);
    const iv = purchaseIntervals(orders);
    if (iv.length >= 2) personalMedians.push(median(iv) as number);
  }
  const popInterval = opts.populationIntervalOverride ?? populationInterval(personalMedians);

  const profiles: CustomerProfile[] = [];
  for (const [id, list] of byCustomer) {
    profiles.push(buildProfile(id, grouped.get(id) as Order[], list, asOf, popInterval));
  }
  return profiles.sort((a, b) => a.customerId.localeCompare(b.customerId));
}

export function buildProfile(customerId: string, orders: Order[], txns: Transaction[], asOf: string, popInterval: number): CustomerProfile {
  const values = orders.map((o) => o.value);
  const first = orders[0].date;
  const last = orders[orders.length - 1].date;
  const recencyDays = daysBetween(last, asOf);
  const tenureDays = Math.max(1, daysBetween(first, asOf));
  const intervals = purchaseIntervals(orders);
  const medianInterval = median(intervals);
  const scale = robustScale(intervals);
  const intervalCv = intervals.length >= 2 && medianInterval ? (1.4826 * (mad(intervals) as number)) / medianInterval : null;

  let rhythmSource: CustomerProfile["rhythmSource"];
  let expectedInterval: number | null;
  if (intervals.length >= 2) {
    rhythmSource = "personal";
    expectedInterval = medianInterval;
  } else if (intervals.length === 1) {
    rhythmSource = "provisional";
    expectedInterval = medianInterval;
  } else {
    rhythmSource = "population";
    expectedInterval = popInterval;
  }
  const overdueRatio = expectedInterval ? recencyDays / expectedInterval : null;
  const gapZScore = intervals.length >= 2 && medianInterval !== null && scale ? (recencyDays - medianInterval) / scale : null;

  let status: BehaviourStatus;
  if (orders.length === 1 || intervals.length === 0) {
    status = recencyDays <= popInterval * 1.5 ? "new" : "insufficient_history";
  } else {
    status = classifyStatus(overdueRatio as number);
  }

  const typicalOrderValue = median(values) as number;
  const valueScale = Math.max(1.4826 * ((mad(values) as number) ?? 0), 0.1 * typicalOrderValue);
  const outlierOrderIds = values.length >= 4 ? orders.filter((o) => o.value > typicalOrderValue + 3 * valueScale).map((o) => o.orderId) : [];

  const recentStart = addDays(asOf, -182);
  const priorStart = addDays(asOf, -364);
  const spendLast180 = round(orders.filter((o) => o.date > recentStart).reduce((s, o) => s + o.value, 0));
  const spendPrior180 = round(orders.filter((o) => o.date > priorStart && o.date <= recentStart).reduce((s, o) => s + o.value, 0));
  const spendTrend = spendPrior180 > 0 ? (spendLast180 - spendPrior180) / spendPrior180 : null;

  const intervalsLengthening =
    intervals.length >= 4 && (median(intervals.slice(-2)) as number) > 1.5 * (median(intervals.slice(0, -2)) as number);

  const catCounts = new Map<string, number>();
  for (const o of orders) for (const c of o.categories) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  const [topCategory, topCount] = [...catCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const categoryShare = topCount / orders.length;

  const issueOrders = orders.filter((o) => o.serviceIssue);
  const latestIssue = issueOrders[issueOrders.length - 1];
  const openServiceIssue =
    latestIssue && latestIssue.serviceIssueResolved !== "yes"
      ? { orderId: latestIssue.orderId, date: latestIssue.date, issue: latestIssue.serviceIssue as string }
      : undefined;
  const resolvedServiceIssues = issueOrders.filter((o) => o.serviceIssueResolved === "yes").length;

  const marketingConsent = latestKnown(txns, "marketingConsent");
  const optedOut = latestKnown(txns, "optedOut");
  const hasCategory = !(catCounts.size === 1 && catCounts.has("Uncategorised"));

  // Evidence quality (data sufficiency, NOT a probability of anything).
  let evidenceScore = (Math.min(orders.length, 8) / 8) * 0.5;
  if (intervalCv !== null) evidenceScore += intervalCv < 0.35 ? 0.3 : intervalCv < 0.7 ? 0.2 : 0.1;
  if (hasCategory) evidenceScore += 0.1;
  if (marketingConsent !== "unknown") evidenceScore += 0.1;
  evidenceScore = round(clamp(evidenceScore, 0, 1), 2);
  const evidenceLevel = evidenceScore >= 0.7 ? "high" : evidenceScore >= 0.45 ? "medium" : "low";

  const profile: CustomerProfile = {
    customerId,
    orders,
    orderCount: orders.length,
    firstOrderDate: first,
    lastOrderDate: last,
    recencyDays,
    tenureDays,
    totalSpend: round(values.reduce((a, b) => a + b, 0)),
    typicalOrderValue: round(typicalOrderValue),
    meanOrderValue: round(mean(values)),
    outlierOrderIds,
    intervals,
    medianInterval,
    intervalCv: intervalCv === null ? null : round(intervalCv, 2),
    expectedInterval,
    rhythmSource,
    overdueRatio: overdueRatio === null ? null : round(overdueRatio, 2),
    gapZScore: gapZScore === null ? null : round(gapZScore, 1),
    ordersPer90Days: round((orders.length / tenureDays) * 90, 2),
    spendLast180,
    spendPrior180,
    spendTrend: spendTrend === null ? null : round(spendTrend, 2),
    intervalsLengthening,
    topCategory,
    categoryShare: round(categoryShare, 2),
    status,
    openServiceIssue,
    resolvedServiceIssues,
    marketingConsent,
    optedOut,
    evidence: [],
    limitations: [],
    evidenceScore,
    evidenceLevel,
  };
  const { evidence, limitations } = describeEvidence(profile, popInterval, hasCategory);
  profile.evidence = evidence;
  profile.limitations = limitations;
  return profile;
}

/** Hard-to-ignore discipline: facts, indicators, hypotheses and unknowns are kept separate. */
export function describeEvidence(p: CustomerProfile, popInterval: number, hasCategory: boolean): { evidence: EvidenceItem[]; limitations: string[] } {
  const e: EvidenceItem[] = [];
  const L: string[] = [];
  const fact = (text: string) => e.push({ kind: "fact", text });
  const ind = (text: string) => e.push({ kind: "indicator", text });
  const exp = (text: string) => e.push({ kind: "explanation", text });
  const unk = (text: string) => e.push({ kind: "unknown", text });

  fact(`${p.orderCount} order${p.orderCount === 1 ? "" : "s"} between ${p.firstOrderDate} and ${p.lastOrderDate}.`);
  fact(`Last order ${p.recencyDays} days before the analysis date (${p.lastOrderDate}).`);
  fact(`Typical order value $${p.typicalOrderValue.toFixed(2)} (median); total spend $${p.totalSpend.toFixed(2)}.`);
  if (hasCategory) fact(`Most frequent category: ${p.topCategory} (${Math.round(p.categoryShare * 100)}% of orders).`);
  if (p.openServiceIssue) fact(`Recorded service issue on ${p.openServiceIssue.date}: "${p.openServiceIssue.issue}" — not marked resolved.`);
  if (p.resolvedServiceIssues > 0) fact(`${p.resolvedServiceIssues} earlier service issue(s) marked resolved.`);

  if (p.rhythmSource === "personal") {
    ind(`Usual gap between orders ≈ ${Math.round(p.medianInterval as number)} days (median of ${p.intervals.length} gaps; variability CV ${p.intervalCv}).`);
    ind(`Current gap is ${p.overdueRatio}× the usual rhythm (robust z-score ${p.gapZScore}).`);
  } else if (p.rhythmSource === "provisional") {
    ind(`Only one gap observed (${p.intervals[0]} days) — rhythm is provisional; current gap is ${p.overdueRatio}× that gap.`);
  } else {
    ind(`Insufficient history to estimate a personal purchasing rhythm. Store-wide typical gap is ≈ ${Math.round(popInterval)} days, used only as context.`);
  }
  if (p.spendTrend !== null) ind(`Spend in last 6 months vs previous 6 months: ${p.spendTrend >= 0 ? "+" : ""}${Math.round(p.spendTrend * 100)}%.`);
  if (p.intervalsLengthening) ind("The two most recent gaps are clearly longer than earlier gaps (frequency declining before the current gap).");
  if (p.outlierOrderIds.length) ind(`${p.outlierOrderIds.length} unusually large order(s) detected; the median is used so they do not inflate the typical value.`);

  if (p.status === "on_rhythm") exp("Customer appears to be buying at their normal pace; no sign that intervention is needed.");
  if (p.openServiceIssue && p.status !== "on_rhythm") exp("The unresolved service issue may have affected their experience — this is a hypothesis to check, not a confirmed cause.");
  if (p.rhythmSource === "personal" && (p.intervalCv as number) < 0.5 && p.categoryShare >= 0.5 && p.status !== "on_rhythm")
    exp(`A regular ${p.topCategory} pattern suggests they may be due to replenish, or may have switched supplier.`);
  if (p.intervalCv !== null && p.intervalCv >= 0.7) exp("Purchases are irregular; a long gap may be normal occasional buying rather than disengagement.");

  unk("Why the customer has not purchased. Inactivity alone does not show dissatisfaction.");
  unk("Purchases made through other channels or competitors are not visible in this data.");
  if (!p.openServiceIssue) unk("No service issue is recorded — absence of a record does not prove a good experience.");
  if (p.marketingConsent === "unknown") unk("Marketing consent is not recorded — the customer is treated as NOT contactable.");

  if (p.orderCount < 3) L.push(`Only ${p.orderCount} order(s): personal rhythm cannot be estimated reliably.`);
  if (p.intervalCv !== null && p.intervalCv >= 0.7) L.push("High variability in purchase gaps reduces confidence in the overdue signal.");
  if (!hasCategory) L.push("No category data — replenishment relevance cannot be assessed.");
  if (p.tenureDays < 120) L.push("Short customer tenure — trend comparisons are unreliable.");
  if (p.spendTrend === null) L.push("No spend in the comparison period — spend trend not calculated.");
  return { evidence: e, limitations: L };
}

export function monthlyRevenue(txns: Transaction[], asOf: string, months = 12): { month: string; revenue: number; orders: number; customers: number }[] {
  const out: { month: string; revenue: number; orders: number; customers: number }[] = [];
  const [y, m] = asOf.split("-").map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    out.push({ month: key, revenue: 0, orders: 0, customers: 0 });
  }
  const idx = new Map(out.map((r, i) => [r.month, i]));
  const orderSeen = new Set<string>();
  const custSeen = new Map<string, Set<string>>();
  for (const t of txns) {
    if (t.date > asOf) continue;
    const k = t.date.slice(0, 7);
    const i = idx.get(k);
    if (i === undefined) continue;
    out[i].revenue += t.value;
    if (!orderSeen.has(t.orderId)) {
      orderSeen.add(t.orderId);
      out[i].orders++;
    }
    const s = custSeen.get(k) ?? new Set<string>();
    s.add(t.customerId);
    custSeen.set(k, s);
  }
  for (const r of out) {
    r.revenue = round(r.revenue, 0);
    r.customers = custSeen.get(r.month)?.size ?? 0;
  }
  return out;
}

export function maxDate(txns: Transaction[]): string | null {
  let m: string | null = null;
  for (const t of txns) if (!m || t.date > m) m = t.date;
  return m;
}
