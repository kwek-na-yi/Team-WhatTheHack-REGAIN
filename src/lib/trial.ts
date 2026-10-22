// THE RECOVERY TRIAL — compares every plausible action against a no-action baseline using
// explicit, editable assumptions. These are heuristic ESTIMATES, not measured causal effects.
//
// For action a, within the horizon H:
//   p0            = baseline purchase probability (status band, heuristic)
//   u_a           = assumed uplift (pp) × evidence-fit multipliers
//   p_a           = min(0.95, p0 + u_a)
//   N             = orders if the customer returns = clamp(H / usual interval, 1, 3)   (1 if no personal rhythm)
//   Revenue_a     = p_a × N × AOV
//   Gross_a       = Revenue_a × margin
//   Costs_a       = contact + p_a × benefit + p_a × discount% × AOV + optOutRisk_a × optOutLoss
//   Net_a         = Gross_a − Costs_a
//   Incremental_a = Net_a − Net_noAction        (Net_noAction = p0 × N × AOV × margin)
//                 = u_a × N × AOV × margin − Costs_a
// Note: the discount is paid by everyone who redeems — including the p0 customers who would have
// bought anyway ("discount leakage"). That is why discounts rarely win on contribution.
import { checkContactPolicy, type PolicyResult } from "./policy";
import type { ActionId, Assumptions, CustomerProfile, Decision, InterventionRecord, ScenarioResult, TrialResult } from "./types";
import { clamp, round } from "./utils";

export const ACTION_LABEL: Record<ActionId, string> = {
  check_in: "Helpful check-in",
  reminder: "Replenishment reminder",
  service_recovery: "Service recovery",
  benefit: "Non-monetary benefit",
  discount: "Discount / incentive",
  no_action: "No action",
};

export const ACTION_ORDER: ActionId[] = ["no_action", "check_in", "reminder", "service_recovery", "benefit", "discount"];

/** Status responsiveness multipliers on uplift: customers already buying normally have little room to move;
 * long-dormant customers are harder to move. Heuristic, documented, editable in code. */
export const RESPONSIVENESS: Record<CustomerProfile["status"], number> = {
  on_rhythm: 0.3,
  slipping: 1,
  lapsed: 0.8,
  dormant: 0.4,
  new: 0.6,
  insufficient_history: 0.5,
};

/** Uncertainty band (± fraction of uplift) by evidence level. */
export const UNCERTAINTY_BAND = { high: 0.5, medium: 0.75, low: 1 } as const;

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  horizonDays: 90,
  marginRate: 0.45,
  baseline: { on_rhythm: 0.65, slipping: 0.4, lapsed: 0.2, dormant: 0.07, new: 0.3 },
  actions: {
    check_in: { upliftPp: 0.04, contactCost: 0.5, benefitCost: 0, discountRate: 0, optOutRiskPp: 0.004 },
    reminder: { upliftPp: 0.07, contactCost: 0.3, benefitCost: 0, discountRate: 0, optOutRiskPp: 0.008 },
    service_recovery: { upliftPp: 0.15, contactCost: 3, benefitCost: 0, discountRate: 0, optOutRiskPp: 0.002 },
    benefit: { upliftPp: 0.06, contactCost: 0.5, benefitCost: 2.5, discountRate: 0, optOutRiskPp: 0.006 },
    discount: { upliftPp: 0.1, contactCost: 0.3, benefitCost: 0, discountRate: 0.15, optOutRiskPp: 0.01 },
  },
  optOutLoss: 25,
  minIncrementalContribution: 0.75,
  irregularReminderFactor: 0.35,
  minDaysBetweenContacts: 14,
  maxContactsPer90Days: 2,
};

export interface TrialOverrides {
  baselineProb?: number;
  typicalOrderValue?: number;
  ordersIfReturn?: number;
}

export function baselineProbability(p: CustomerProfile, a: Assumptions): number {
  if (p.status === "insufficient_history") return a.baseline.dormant;
  return a.baseline[p.status];
}

export function ordersIfReturn(p: CustomerProfile, a: Assumptions): number {
  if (p.rhythmSource !== "personal" || !p.expectedInterval) return 1;
  return round(clamp(a.horizonDays / p.expectedInterval, 1, 3), 2);
}

/** True when the customer shows a regular, category-concentrated pattern a reminder could be relevant to. */
export function hasReplenishmentPattern(p: CustomerProfile): boolean {
  return p.rhythmSource === "personal" && p.intervalCv !== null && p.intervalCv < 0.5 && p.categoryShare >= 0.5;
}

interface EconomicsInput {
  action: ActionId;
  p0: number;
  uplift: number;
  N: number;
  aov: number;
  margin: number;
  contactCost: number;
  benefitCost: number;
  discountRate: number;
  optOutRiskPp: number;
  optOutLoss: number;
}

/** Pure arithmetic for one scenario. Exported for testing. */
export function scenarioEconomics(x: EconomicsInput) {
  const p1 = x.action === "no_action" ? x.p0 : clamp(x.p0 + x.uplift, 0, 0.95);
  const realisedUplift = p1 - x.p0;
  const expectedOrders = p1 * x.N;
  const expectedRevenue = expectedOrders * x.aov;
  const grossContribution = expectedRevenue * x.margin;
  const contactCost = x.action === "no_action" ? 0 : x.contactCost;
  const benefitCost = p1 * x.benefitCost;
  const discountCost = p1 * x.discountRate * x.aov;
  const discountLeakage = x.p0 * x.discountRate * x.aov;
  const experienceRiskCost = x.action === "no_action" ? 0 : x.optOutRiskPp * x.optOutLoss;
  const totalCost = contactCost + benefitCost + discountCost + experienceRiskCost;
  const netContribution = grossContribution - totalCost;
  const baselineNet = x.p0 * x.N * x.aov * x.margin;
  return {
    actionProb: p1,
    upliftPp: realisedUplift,
    expectedOrders,
    expectedRevenue,
    grossContribution,
    contactCost,
    benefitCost,
    discountCost,
    discountLeakage,
    experienceRiskCost,
    totalCost,
    netContribution,
    incrementalRevenue: expectedRevenue - x.p0 * x.N * x.aov,
    incrementalContribution: netContribution - baselineNet,
  };
}

export interface TrialContext {
  assumptions: Assumptions;
  interventions: InterventionRecord[];
  asOf: string;
  overrides?: TrialOverrides;
  /** Pre-computed policy result (used by the simulator so policy is not re-evaluated). */
  policy?: PolicyResult;
  suppressedUntil?: Record<string, string>;
}

export function runTrial(p: CustomerProfile, ctx: TrialContext): TrialResult {
  const a = ctx.assumptions;
  const policy = ctx.policy ?? checkContactPolicy(p, ctx.interventions, ctx.asOf, a, ctx.suppressedUntil);
  const p0 = clamp(ctx.overrides?.baselineProb ?? baselineProbability(p, a), 0, 0.95);
  const aov = ctx.overrides?.typicalOrderValue ?? p.typicalOrderValue;
  const N = ctx.overrides?.ordersIfReturn ?? ordersIfReturn(p, a);
  const band = clamp(UNCERTAINTY_BAND[p.evidenceLevel] + (p.rhythmSource === "personal" ? 0 : 0.25), 0, 1.25);
  const responsiveness = RESPONSIVENESS[p.status];
  const replenish = hasReplenishmentPattern(p);
  const issue = !!p.openServiceIssue;

  const scenarios: ScenarioResult[] = ACTION_ORDER.map((action) => {
    const notes: string[] = [];
    let eligible = true;
    let ineligibleReason: string | undefined;
    const cfg = action === "no_action" ? { upliftPp: 0, contactCost: 0, benefitCost: 0, discountRate: 0, optOutRiskPp: 0 } : a.actions[action];
    let uplift = cfg.upliftPp * responsiveness;
    let risk = cfg.optOutRiskPp;
    if (action !== "no_action") {
      if (responsiveness !== 1) notes.push(`Uplift × ${responsiveness} for status "${p.status.replace("_", " ")}".`);
      if (!policy.allowed) {
        eligible = false;
        ineligibleReason = policy.reason;
      }
    }
    if (action === "service_recovery" && !issue) {
      eligible = false;
      ineligibleReason = ineligibleReason ?? "No recorded service issue — service recovery would be an unsupported claim.";
    }
    if (action === "reminder" && !replenish) {
      uplift *= a.irregularReminderFactor;
      notes.push(`No regular purchase pattern: reminder uplift × ${a.irregularReminderFactor}.`);
    }
    if (issue && (action === "reminder" || action === "benefit" || action === "discount")) {
      uplift *= 0.5;
      risk *= 3;
      notes.push("Unresolved service issue: promotional message assumed half as effective with 3× opt-out risk.");
    }
    const common = { action, p0, N, aov, margin: a.marginRate, contactCost: cfg.contactCost, benefitCost: cfg.benefitCost, discountRate: cfg.discountRate, optOutRiskPp: risk, optOutLoss: a.optOutLoss };
    const mid = scenarioEconomics({ ...common, uplift });
    const lo = scenarioEconomics({ ...common, uplift: uplift * (1 - band) });
    const hi = scenarioEconomics({ ...common, uplift: uplift * (1 + band) });
    if (action === "discount" && mid.discountLeakage > 0) notes.push(`$${mid.discountLeakage.toFixed(2)} of expected discount goes to purchases that would likely happen anyway.`);
    return {
      action,
      label: ACTION_LABEL[action],
      eligible,
      ineligibleReason,
      baselineProb: p0,
      ordersIfReturn: N,
      ...mid,
      incrementalLow: Math.min(lo.incrementalContribution, hi.incrementalContribution),
      incrementalHigh: Math.max(lo.incrementalContribution, hi.incrementalContribution),
      notes,
    };
  });

  const byId = Object.fromEntries(scenarios.map((s) => [s.action, s])) as Record<ActionId, ScenarioResult>;
  const eligibleContact = scenarios
    .filter((s) => s.action !== "no_action" && s.eligible)
    .sort((x, y) => y.incrementalContribution - x.incrementalContribution || x.totalCost - y.totalCost);
  // With an unresolved service issue, resolving it comes first unless it is expected to lose money:
  // promoting to a customer with an open complaint is presumptive and risky.
  const sr = byId.service_recovery;
  const best = issue && sr.eligible && sr.incrementalContribution >= 0 ? sr : eligibleContact[0];

  const reasons: string[] = [];
  const unknowns = [
    "Uplift values are assumptions, not measured effects. A randomised holdout test (Impact Lab) is needed to measure the real effect.",
    ...p.evidence.filter((e) => e.kind === "unknown").map((e) => e.text),
  ];
  let decision: Decision = "HOLD";
  let recommended: ActionId = "no_action";
  let headline = "";

  const history = ctx.interventions.filter((r) => r.customerId === p.customerId && r.group !== "control" && r.date <= ctx.asOf);
  if (history.length) {
    const lastH = history[history.length - 1];
    reasons.push(`Previous contact on ${lastH.date} (${lastH.action.replace("_", " ")}); outcome recorded: ${lastH.purchased === "yes" ? "purchased" : lastH.purchased === "no" ? "did not purchase" : "unknown"}.`);
  }

  if (!policy.allowed) {
    headline = "HOLD — contact not permitted";
    reasons.unshift(policy.reason as string);
  } else if (p.status === "insufficient_history") {
    headline = "HOLD — insufficient history";
    reasons.unshift("Only one purchase and no repeat pattern: there is not enough evidence to judge disengagement or to justify contact.");
  } else if (p.status === "new") {
    headline = "HOLD — too early to judge";
    reasons.unshift("New customer with one order, still within a normal store-wide gap. Contacting now would not be a recovery.");
  } else if (p.status === "on_rhythm") {
    headline = "HOLD — buying at normal pace";
    reasons.unshift(`Current gap (${p.recencyDays} days) is within the customer's usual rhythm. Most of any contact's effect would be on purchases that were happening anyway.`);
  } else if (!(issue || replenish)) {
    // Cause unclear: do not act on a guessed explanation. Ask, if asking pays for itself in expectation.
    const ci = byId.check_in;
    if (ci.eligible && ci.incrementalContribution >= 0) {
      decision = "UNDERSTAND";
      recommended = "check_in";
      headline = "UNDERSTAND — ask before acting";
      reasons.unshift(
        "The customer has slowed down but the data does not show why (no recorded issue, no regular replenishment pattern). A low-pressure question is cheaper and less presumptive than an offer.",
      );
      if (best && best.action !== "check_in" && best.incrementalContribution > ci.incrementalContribution)
        reasons.push(`${best.label} scores higher on paper ($${best.incrementalContribution.toFixed(2)}) but would act on an unverified explanation.`);
      reasons.push(`Check-in expected incremental contribution: $${ci.incrementalContribution.toFixed(2)} (range $${ci.incrementalLow.toFixed(2)} to $${ci.incrementalHigh.toFixed(2)}). The answer itself is the main value.`);
    } else {
      headline = "HOLD — reason unclear and clarification not worth the cost";
      reasons.unshift(`Disengagement reason is unclear and even a check-in is not expected to cover its cost ($${ci.incrementalContribution.toFixed(2)}).`);
    }
  } else if (!best || best.incrementalContribution < a.minIncrementalContribution) {
    headline = "HOLD — expected benefit does not justify the cost";
    reasons.unshift(
      best
        ? `Best option (${best.label}) is estimated at $${best.incrementalContribution.toFixed(2)} incremental contribution, below the $${a.minIncrementalContribution.toFixed(2)} threshold.`
        : "No eligible contact action.",
    );
  } else {
    decision = "RECOVER";
    recommended = best.action;
    headline = `RECOVER — ${best.label.toLowerCase()}`;
    reasons.unshift(
      best.action === "service_recovery"
        ? `An unresolved service issue is recorded ("${p.openServiceIssue?.issue}"). Resolving it is the evidence-supported action and comes before any promotion.`
        : replenish
          ? `A regular ${p.topCategory} pattern (every ≈${Math.round(p.medianInterval ?? 0)} days) is now ${p.overdueRatio}× overdue.`
          : `An unresolved service issue is recorded, but service recovery is not expected to cover its cost; ${best.label.toLowerCase()} is the best remaining option.`,
    );
    reasons.push(`${best === eligibleContact[0] ? "Highest expected incremental contribution among eligible actions" : "Chosen ahead of higher-scoring promotional options; expected incremental contribution"}: $${best.incrementalContribution.toFixed(2)} (range $${best.incrementalLow.toFixed(2)} to $${best.incrementalHigh.toFixed(2)}).`);
    if (best.incrementalLow < 0) reasons.push("The low end of the range is negative — the action could lose money if the assumed uplift is optimistic.");
  }

  if (decision === "HOLD" && issue && policy.allowed !== false)
    reasons.push("An unresolved service issue is recorded. Resolving it through normal customer service is advisable regardless of this marketing decision.");

  const chosen = byId[recommended];
  const rejected = scenarios
    .filter((s) => s.action !== recommended)
    .map((s) => {
      let reason: string;
      if (!s.eligible) reason = s.ineligibleReason ?? "Not eligible.";
      else if (s.action === "no_action") reason = `Rejected: ${chosen.label} is expected to add $${chosen.incrementalContribution.toFixed(2)} over doing nothing.`;
      else if (decision === "HOLD") reason = `Expected incremental contribution $${s.incrementalContribution.toFixed(2)} — not justified under the current decision rule.`;
      else if (decision === "UNDERSTAND" && s.incrementalContribution > chosen.incrementalContribution) reason = `Would assume a reason for disengagement that is not evidenced ($${s.incrementalContribution.toFixed(2)} on paper).`;
      else if (s.action === "discount") reason = `Discount cost $${s.discountCost.toFixed(2)} (of which $${s.discountLeakage.toFixed(2)} leaks to likely buyers) leaves $${s.incrementalContribution.toFixed(2)} incremental.`;
      else reason = `Lower expected incremental contribution ($${s.incrementalContribution.toFixed(2)} vs $${chosen.incrementalContribution.toFixed(2)}).`;
      return { action: s.action, reason };
    });

  return {
    customerId: p.customerId,
    decision,
    recommendedAction: recommended,
    headline,
    reasons,
    rejected,
    scenarios,
    unknowns,
    suppression: policy.suppression,
    priorityScore: decision === "HOLD" ? 0 : round(chosen.incrementalContribution, 2),
    uncertaintyBand: band,
  };
}

export const DECISION_STYLE: Record<Decision, string> = {
  RECOVER: "bg-recover-bg text-recover border-recover/30",
  UNDERSTAND: "bg-understand-bg text-understand border-understand/30",
  HOLD: "bg-hold-bg text-hold border-hold/30",
};
