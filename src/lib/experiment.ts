// Treatment-vs-control experiments: reproducible assignment, outcome recording and impact metrics
// with honest uncertainty. Simulated outcomes are always labelled and never mixed with observed ones.
import type { ActionId, InterventionRecord, Transaction } from "./types";
import { addDays, fnv1a, mulberry32, round } from "./utils";

export type Group = "treatment" | "control";
export type OutcomeSource = "simulated" | "manual" | "measured";

export interface ExperimentMember {
  customerId: string;
  group: Group;
  /** Action treatment customers receive (control customers receive nothing). */
  action: ActionId;
  /** Assumed purchase probability under the group's condition (used ONLY for simulation). */
  assumedProb: number;
  typicalOrderValue: number;
  contactCost: number;
  discountRate: number;
  benefitCost: number;
}

export interface Outcome {
  purchased: boolean | null; // null = pending / not yet observable
  revenue: number;
  optedOut: boolean;
  negative: boolean;
  source: OutcomeSource;
}

export interface Experiment {
  id: string;
  name: string;
  startDate: string;
  windowDays: number;
  seed: string;
  holdoutShare: number;
  marginRate: number;
  members: ExperimentMember[];
  outcomes: Record<string, Outcome>;
  createdAt: string;
}

/** Deterministic: the same customer, seed and share always land in the same group. */
export function assignGroup(customerId: string, seed: string, holdoutShare: number): Group {
  const u = fnv1a(`${seed}::${customerId}`) / 4294967296;
  return u < holdoutShare ? "control" : "treatment";
}

export type ExperimentCandidate = Omit<ExperimentMember, "group" | "assumedProb"> & { baselineProb: number; actionProb: number };

export function createExperiment(params: {
  id: string;
  name: string;
  startDate: string;
  windowDays: number;
  seed: string;
  holdoutShare: number;
  marginRate: number;
  candidates: ExperimentCandidate[];
  createdAt: string;
}): Experiment {
  const members: ExperimentMember[] = params.candidates.map((cc) => {
    const group = assignGroup(cc.customerId, params.seed, params.holdoutShare);
    return {
      customerId: cc.customerId,
      action: cc.action,
      typicalOrderValue: cc.typicalOrderValue,
      contactCost: cc.contactCost,
      discountRate: cc.discountRate,
      benefitCost: cc.benefitCost,
      group,
      assumedProb: group === "control" ? cc.baselineProb : cc.actionProb,
    };
  });
  return { id: params.id, name: params.name, startDate: params.startDate, windowDays: params.windowDays, seed: params.seed, holdoutShare: params.holdoutShare, marginRate: params.marginRate, members, outcomes: {}, createdAt: params.createdAt };
}

/** SIMULATION ONLY — draws outcomes from the app's own assumptions with a seeded PRNG.
 * It demonstrates the measurement mechanics; it cannot provide evidence about real effects. */
export function simulateOutcomes(exp: Experiment, seed = 1): Record<string, Outcome> {
  const rng = mulberry32(fnv1a(`${exp.seed}:${seed}`));
  const out: Record<string, Outcome> = {};
  for (const m of exp.members) {
    const purchased = rng() < m.assumedProb;
    const optedOut = m.group === "treatment" && rng() < 0.01;
    out[m.customerId] = { purchased, revenue: purchased ? round(m.typicalOrderValue, 2) : 0, optedOut, negative: optedOut, source: "simulated" };
  }
  return out;
}

/** Observed outcomes from transactions dated inside the window. Pending if the window has not closed. */
export function measureOutcomes(exp: Experiment, txns: Transaction[], asOf: string): Record<string, Outcome> {
  const end = addDays(exp.startDate, exp.windowDays);
  const windowClosed = asOf >= end;
  const ids = new Set(exp.members.map((m) => m.customerId));
  const rev = new Map<string, number>();
  for (const t of txns) {
    if (!ids.has(t.customerId)) continue;
    if (t.date > exp.startDate && t.date <= end && t.date <= asOf) rev.set(t.customerId, (rev.get(t.customerId) ?? 0) + t.value);
  }
  const out: Record<string, Outcome> = {};
  for (const m of exp.members) {
    const prev = exp.outcomes[m.customerId];
    const r = rev.get(m.customerId);
    if (r !== undefined) out[m.customerId] = { purchased: true, revenue: round(r, 2), optedOut: prev?.optedOut ?? false, negative: prev?.negative ?? false, source: "measured" };
    else out[m.customerId] = { purchased: windowClosed ? false : null, revenue: 0, optedOut: prev?.optedOut ?? false, negative: prev?.negative ?? false, source: "measured" };
  }
  return out;
}

// ---------------- statistics ----------------

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Newcombe hybrid score interval for p1 - p2. */
export function newcombeDiff(x1: number, n1: number, x2: number, n2: number): [number, number] {
  const p1 = n1 ? x1 / n1 : 0;
  const p2 = n2 ? x2 / n2 : 0;
  const [l1, u1] = wilson(x1, n1);
  const [l2, u2] = wilson(x2, n2);
  const d = p1 - p2;
  return [d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)];
}

/** Two-sided p-value of a pooled two-proportion z-test. */
export function twoProportionP(x1: number, n1: number, x2: number, n2: number): number | null {
  if (!n1 || !n2) return null;
  const pool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = (x1 / n1 - x2 / n2) / se;
  return 2 * (1 - normCdf(Math.abs(z)));
}

/** Customers needed per arm to detect p1 vs p2 (two-sided α=0.05, power 0.8 by default). */
export function sampleSizePerArm(p1: number, p2: number, zAlpha = 1.96, zBeta = 0.8416): number {
  const d = Math.abs(p1 - p2);
  if (d === 0) return Infinity;
  return Math.ceil(((zAlpha + zBeta) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (d * d));
}

export interface ArmStats {
  n: number;
  observed: number;
  pending: number;
  purchases: number;
  rate: number;
  rateCi: [number, number];
  revenue: number;
  optOuts: number;
  negatives: number;
}

export interface ImpactMetrics {
  eligible: number;
  treatment: ArmStats;
  control: ArmStats;
  diffPp: number;
  diffCi: [number, number];
  pValue: number | null;
  incrementalPurchases: number;
  incrementalRevenue: number;
  interventionCost: number;
  discountCost: number;
  incrementalContribution: number;
  sources: OutcomeSource[];
  warnings: string[];
  requiredPerArm: number | null;
}

function arm(members: ExperimentMember[], outcomes: Record<string, Outcome>): ArmStats {
  let observed = 0, purchases = 0, revenue = 0, optOuts = 0, negatives = 0, pending = 0;
  for (const m of members) {
    const o = outcomes[m.customerId];
    if (!o || o.purchased === null) {
      pending++;
      if (o?.optedOut) optOuts++;
      continue;
    }
    observed++;
    if (o.purchased) purchases++;
    revenue += o.revenue;
    if (o.optedOut) optOuts++;
    if (o.negative) negatives++;
  }
  const rate = observed ? purchases / observed : 0;
  return { n: members.length, observed, pending, purchases, rate, rateCi: wilson(purchases, observed), revenue: round(revenue, 2), optOuts, negatives };
}

export function computeImpact(exp: Pick<Experiment, "members" | "outcomes" | "marginRate">): ImpactMetrics {
  const T = exp.members.filter((m) => m.group === "treatment");
  const C = exp.members.filter((m) => m.group === "control");
  const t = arm(T, exp.outcomes);
  const c = arm(C, exp.outcomes);
  const diff = t.rate - c.rate;
  const ci = newcombeDiff(t.purchases, t.observed, c.purchases, c.observed);
  const p = twoProportionP(t.purchases, t.observed, c.purchases, c.observed);
  // Incremental purchases among observed treatment customers vs what the control rate implies.
  const incrementalPurchases = t.observed ? round(diff * t.observed, 1) : 0;
  const revPerT = t.observed ? t.revenue / t.observed : 0;
  const revPerC = c.observed ? c.revenue / c.observed : 0;
  const incrementalRevenue = round((revPerT - revPerC) * t.observed, 2);
  // Costs: every treated customer is contacted; discount/benefit only paid by treated purchasers.
  let interventionCost = 0, discountCost = 0;
  for (const m of T) {
    const o = exp.outcomes[m.customerId];
    interventionCost += m.contactCost;
    if (o?.purchased) {
      discountCost += m.discountRate * (o.revenue || m.typicalOrderValue);
      interventionCost += m.benefitCost;
    }
  }
  interventionCost = round(interventionCost, 2);
  discountCost = round(discountCost, 2);
  const incrementalContribution = round(incrementalRevenue * exp.marginRate - interventionCost - discountCost, 2);
  const sources = [...new Set(Object.values(exp.outcomes).map((o) => o.source))];
  const warnings: string[] = [];
  if (sources.includes("simulated")) warnings.push("SIMULATED outcomes: generated from REGAIN's own assumptions. They show how measurement works and are NOT evidence of real impact.");
  if (t.observed < 100 || c.observed < 100) warnings.push(`Small sample (${t.observed} treatment / ${c.observed} control observed). Differences of this size can easily arise by chance.`);
  if (t.observed && c.observed && ci[0] < 0 && ci[1] > 0) warnings.push("The 95% interval for the difference includes zero: the data are consistent with no effect.");
  if (t.pending + c.pending > 0) warnings.push(`${t.pending + c.pending} customers are pending (window still open or not recorded) and are excluded — they are not counted as recoveries.`);
  const requiredPerArm = c.observed && t.observed && diff !== 0 ? sampleSizePerArm(c.rate, Math.min(0.99, Math.max(0.01, t.rate))) : null;
  return { eligible: exp.members.length, treatment: t, control: c, diffPp: diff, diffCi: ci, pValue: p, incrementalPurchases, incrementalRevenue, interventionCost, discountCost, incrementalContribution, sources, warnings, requiredPerArm };
}

export interface HistoricalComparison {
  campaign: string;
  action: string;
  date: string;
  treatment: { n: number; purchases: number; optOuts: number };
  control: { n: number; purchases: number };
  diffPp: number;
  diffCi: [number, number];
  pValue: number | null;
  /** REGAIN cannot verify how imported groups were assigned. */
  assignmentVerified: false;
}

/** Analyse imported campaigns that include a control group. Records with unknown outcomes are excluded. */
export function analyseHistorical(records: InterventionRecord[]): HistoricalComparison[] {
  const byCampaign = new Map<string, InterventionRecord[]>();
  for (const r of records) {
    if (r.source !== "imported") continue;
    const arr = byCampaign.get(r.campaign) ?? [];
    arr.push(r);
    byCampaign.set(r.campaign, arr);
  }
  const out: HistoricalComparison[] = [];
  for (const [campaign, rs] of byCampaign) {
    const control = rs.filter((r) => r.group === "control" && r.purchased !== "unknown");
    if (!control.length) continue;
    const actions = [...new Set(rs.filter((r) => r.group === "treatment").map((r) => r.action))];
    for (const action of actions) {
      const t = rs.filter((r) => r.group === "treatment" && r.action === action && r.purchased !== "unknown");
      if (!t.length) continue;
      const tx = t.filter((r) => r.purchased === "yes").length;
      const cx = control.filter((r) => r.purchased === "yes").length;
      out.push({
        campaign,
        action,
        date: rs.map((r) => r.date).sort()[0],
        treatment: { n: t.length, purchases: tx, optOuts: t.filter((r) => r.optedOut === "yes").length },
        control: { n: control.length, purchases: cx },
        diffPp: tx / t.length - cx / control.length,
        diffCi: newcombeDiff(tx, t.length, cx, control.length),
        pValue: twoProportionP(tx, t.length, cx, control.length),
        assignmentVerified: false,
      });
    }
  }
  return out;
}
