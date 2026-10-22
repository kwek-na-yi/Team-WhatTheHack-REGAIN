// REGAIN DECISION COPILOT — answers questions about the app's own decisions, what-ifs, portfolio and
// experiments. Every figure, eligibility flag, decision, count and statistic comes from the existing
// engine (analyse / runTrial / checkContactPolicy / computeImpact / analyseHistorical). Nothing here
// invents a formula. An optional language model may only reword the summary (see copilotGuard.ts).
// All functions are pure: answering a question never changes application state.
import { analyse, type Analysis } from "./analysis";
import { analyseHistorical, computeImpact } from "./experiment";
import { ACTION_SHORT, ACTION_VERB, DECISION_DEF, holdReason, signalText } from "./present";
import type { AppAction, AppState } from "./store";
import { ACTION_LABEL, runTrial } from "./trial";
import type { ActionId, Assumptions, CustomerProfile, Decision, ScenarioResult, TrialResult } from "./types";
import { clamp, fmtMoney, fmtPct, fmtPp } from "./utils";

export type CopilotIntent =
  | "explain"
  | "why_not"
  | "missing"
  | "plan"
  | "compare"
  | "what_if"
  | "portfolio"
  | "experiment"
  | "policy_refusal"
  | "not_allowed"
  | "need_customer"
  | "unsupported"
  | "no_data";

/** Where a statement comes from. Mirrors the engine's evidence discipline. */
export type StatementKind = "fact" | "indicator" | "explanation" | "unknown" | "estimate" | "simulated" | "rule" | "step";

export const STATEMENT_LABEL: Record<StatementKind, string> = {
  fact: "Observed",
  indicator: "Calculated",
  explanation: "Possible explanation",
  unknown: "Unknown",
  estimate: "Estimated",
  simulated: "Simulated",
  rule: "Rule",
  step: "Next step",
};

export interface Statement {
  kind: StatementKind;
  text: string;
}

export interface ComparisonRow {
  action: ActionId;
  label: string;
  eligible: boolean;
  recommended: boolean;
  incremental: number;
  low: number;
  high: number;
  cost: number;
  /** Value under the saved assumptions, shown when a what-if changed it. */
  savedIncremental?: number;
  reason: string;
  /** Every contact action's effect is an editable assumption until a randomised test measures it. */
  dependsOnAssumptions: boolean;
}

export interface CustomerCard {
  customerId: string;
  signal: string;
  decision: Decision;
  action: ActionId;
  /** Estimated incremental contribution of the recommended action; null for Hold. */
  value: number | null;
  reason: string;
}

export interface ExperimentSummary {
  title: string;
  evidence: "simulated" | "randomised" | "observed_unverified" | "pending";
  verdict: "positive" | "negative" | "inconclusive" | "no_data";
  treatment: { n: number; purchases: number; rate: number };
  control: { n: number; purchases: number; rate: number };
  diffPp: number;
  ci: [number, number];
  pValue: number | null;
  pending: number;
  incrementalContribution: number | null;
  requiredPerArm: number | null;
  syntheticData: boolean;
}

export interface AssumptionProposal {
  /** Assumptions the user would save on confirmation. */
  assumptions: Assumptions;
  /** Snapshot of the saved assumptions the preview was computed against (stale-check). */
  baseJson: string;
  changes: string[];
  note: string;
  /** Customers whose decision or recommended action would change across the portfolio. */
  decisionsChanged: number;
}

export interface CopilotLink {
  label: string;
  href: string;
  /** Selects this customer as the active case before navigating. */
  customerId?: string;
}

export interface CopilotAnswer {
  intent: CopilotIntent;
  title: string;
  /** The customer this answer is about, if any. */
  customerId?: string;
  summary: string;
  statements: Statement[];
  comparison?: { rows: ComparisonRow[]; hypothetical: boolean; changes: string[] };
  customers?: { cards: CustomerCard[]; total: number };
  experiment?: ExperimentSummary;
  proposal?: AssumptionProposal;
  links: CopilotLink[];
  source: "deterministic";
}

export type CopilotState = Pick<AppState, "transactions" | "interventions" | "asOf" | "assumptions" | "suppressedUntil" | "experiments" | "dataSource">;

export interface CopilotContext {
  state: CopilotState;
  analysis: Analysis;
  /** Active customer (from the page or the saved selection). */
  customerId: string | null;
}

export const MAX_QUESTION = 300;
export const MAX_CARDS = 6;

/* ------------------------------------------------------------------ routing */

// An attempt to change a hard rule: an override verb aimed at a rule, or a hypothetical that flips
// consent / opt-out / limits. Portfolio questions that only mention consent ("customers with no consent") pass.
const BYPASS =
  /\b(ignore|bypass|override|skip|remove|disable|turn off|switch off|get around|work around|lift|waive)\b.*\b(consent|opt.?outs?|unsubscribe|declin\w*|contact (limit|cap|rule)s?|frequency|cap|suppression|rules?)\b|\b(what if|suppose|assume|pretend|imagine|treat\w*|as if)\b.*\b(consent\w*|opt\w*.?out|unsubscrib\w*|declin\w*|contact (limit|cap)s?|frequency)\b|\bcontact (them|this customer|anyway)\b.*\b(anyway|regardless)\b/;
const NOT_ALLOWED = /\b(approve|send|reset|delete|clear|record|import|upload)\b.*\b(message|draft|data|outcomes?|experiment|it|everything|all)\b|\bsend it\b/;
const EXPERIMENT =
  /\b(experiments?|campaigns?|holdout|control group|treatment|statistical\w*|significance|by chance|due to chance|confidence interval|repeat.?purchase rate|this result|reliable|sample size|worth (its|the) cost|exp-\d+)\b/;
const PORTFOLIO = /\b(customers|who|portfolio|review first|everyone|weakest|anyone|any customer|decisions|recommended actions|how many)\b/;
const WHAT_IF = /\b(what if|what happens if|suppose|assume|reduce|increase|lower|raise|change|set)\b/;
const COMPARE = /\b(compare|comparison|versus|vs\.?|alternatives?|best estimated|doing nothing|no action|instead|other options?|options)\b/;
const WHY_NOT = /\b(why not|why (aren'?t|isn'?t|don'?t|didn'?t)|rather than|instead of)\b/;
const MISSING = /\b(missing|unknowns?|don'?t know|do not know|what information|gaps? in|not know)\b/;
const PLAN = /\b(plan|next steps?|what should i do|what now|what do i do)\b/;

const ACTION_WORDS: [ActionId, RegExp][] = [
  ["discount", /\b(discount|incentive|voucher|coupon|% off)\w*/],
  ["reminder", /\b(reminder|remind|replenish)\w*/],
  ["check_in", /\bcheck.?in\b/],
  ["service_recovery", /\b(service recovery|fix the service|resolve the complaint)\b/],
  ["benefit", /\b(benefit|thank.?you|perk|gift)\b/],
  ["no_action", /\b(no action|doing nothing|do nothing|nothing)\b/],
];

function actionsIn(q: string): ActionId[] {
  return ACTION_WORDS.filter(([, re]) => re.test(q)).map(([a]) => a);
}

/** A customer ID typed in the question, matched only against real records. */
export function mentionedCustomer(question: string, analysis: Analysis): string | null {
  for (const tok of question.match(/[A-Za-z0-9_-]{2,40}/g) ?? []) {
    if (analysis.byId[tok]) return tok;
    if (analysis.byId[tok.toUpperCase()]) return tok.toUpperCase();
  }
  return null;
}

/** Answers one question deterministically. Never mutates `ctx`. */
export function answerQuestion(question: string, ctx: CopilotContext): CopilotAnswer {
  const raw = question.slice(0, MAX_QUESTION);
  const q = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const { analysis } = ctx;
  if (!analysis.profiles.length)
    return base("no_data", "No customer data loaded", "There is no customer data to analyse yet. Load the demo dataset or upload a transaction CSV first.", [], [{ label: "Data & Integrations", href: "/data" }]);

  const mentioned = mentionedCustomer(raw, analysis);
  const active = mentioned ?? (ctx.customerId && analysis.byId[ctx.customerId] ? ctx.customerId : null);

  if (BYPASS.test(q)) return policyRefusal(ctx, active);
  if (NOT_ALLOWED.test(q)) return notAllowed(q, active);
  if (EXPERIMENT.test(q)) return experimentAnswer(q, ctx, active);
  if (!mentioned && (PORTFOLIO.test(q) || !active)) {
    if (PORTFOLIO.test(q) || /\b(held|holding|complaints?|consent|negative|evidence)\b/.test(q)) return portfolioAnswer(q, ctx);
    return needCustomer(ctx);
  }
  const cid = active as string;
  const acts = actionsIn(q);
  if (WHY_NOT.test(q) && acts.length) return whyNotAnswer(ctx, cid, acts[0]);
  if (WHAT_IF.test(q)) {
    const spec = parseWhatIf(q, ctx.state.assumptions);
    if (spec) return whatIfAnswer(ctx, cid, spec);
    if (!COMPARE.test(q)) return whatIfUnsupported(ctx, cid);
  }
  if (/\bcomplaints?\b/.test(q)) return explainAnswer(ctx, cid);
  if (COMPARE.test(q)) return compareAnswer(q, ctx, cid, acts);
  if (MISSING.test(q)) return missingAnswer(ctx, cid);
  if (PLAN.test(q)) return planAnswer(ctx, cid);
  return explainAnswer(ctx, cid);
}

function base(intent: CopilotIntent, title: string, summary: string, statements: Statement[], links: CopilotLink[], extra: Partial<CopilotAnswer> = {}): CopilotAnswer {
  return { intent, title, summary, statements, links, source: "deterministic", ...extra };
}

const decisionTitle = (d: Decision) => DECISION_DEF[d].title;
const caseLinks = (id: string, t: TrialResult): CopilotLink[] => [
  { label: "Recovery Decisions", href: `/trial?id=${id}`, customerId: id },
  { label: "Customer Insights", href: `/insights?id=${id}`, customerId: id },
  ...(t.decision !== "HOLD" ? [{ label: "Conversation Studio", href: `/studio?id=${id}`, customerId: id }] : []),
];

/* ------------------------------------------------------- A. explain decision */

function evidenceStatements(p: CustomerProfile, t: TrialResult, limits = { fact: 4, indicator: 3, unknown: 2 }): Statement[] {
  const out: Statement[] = [];
  const of = (k: CustomerProfile["evidence"][number]["kind"]) => p.evidence.filter((e) => e.kind === k);
  // A recorded complaint is always shown, even when other facts are trimmed.
  const facts = of("fact").sort((x, y) => Number(y.text.startsWith("Recorded service issue")) - Number(x.text.startsWith("Recorded service issue")));
  out.push(...facts.slice(0, limits.fact).map((e) => ({ kind: "fact" as const, text: e.text })));
  if (!p.openServiceIssue) out.push({ kind: "fact", text: "No complaint or service issue is on record for this customer." });
  out.push(...of("indicator").slice(0, limits.indicator).map((e) => ({ kind: "indicator" as const, text: e.text })));
  out.push(...of("explanation").map((e) => ({ kind: "explanation" as const, text: e.text })));
  out.push(...of("unknown").slice(0, limits.unknown).map((e) => ({ kind: "unknown" as const, text: e.text })));
  out.push(...complaintRule(p, t));
  if (t.suppression) out.push({ kind: "rule", text: t.reasons[0] });
  return out;
}

/** How a recorded, unresolved complaint changes the options — quoted from the engine's own notes. */
function complaintRule(p: CustomerProfile, t: TrialResult): Statement[] {
  if (!p.openServiceIssue) return [];
  const note = t.scenarios.flatMap((s) => s.notes).find((n) => n.startsWith("Unresolved service issue"));
  const sr = t.scenarios.find((s) => s.action === "service_recovery") as ScenarioResult;
  return [
    {
      kind: "rule",
      text: `Because a complaint is recorded and not marked resolved, service recovery is ${sr.eligible ? "available" : `not available (${sr.ineligibleReason})`} and is preferred over promotions unless it is expected to lose money.${note ? ` ${note}` : ""}`,
    },
  ];
}

function historyCaveat(p: CustomerProfile): string {
  if (p.status === "insufficient_history" || p.status === "new")
    return " There isn't enough purchase history to judge whether this customer is drifting away — REGAIN does not treat them as at risk.";
  return "";
}

function estimateStatement(t: TrialResult): Statement[] {
  if (t.decision === "HOLD") return [];
  const s = scenario(t, t.recommendedAction);
  return [
    {
      kind: "estimate",
      text: `${ACTION_LABEL[s.action]}: about ${fmtMoney(s.incrementalContribution, 2)} extra contribution versus doing nothing (range ${fmtMoney(s.incrementalLow, 2)} to ${fmtMoney(s.incrementalHigh, 2)}), for an expected cost of ${fmtMoney(s.totalCost, 2)}. Based on editable assumptions, not a measured effect.`,
    },
  ];
}

const scenario = (t: TrialResult, a: ActionId) => t.scenarios.find((s) => s.action === a) as ScenarioResult;

export function explainAnswer(ctx: CopilotContext, id: string): CopilotAnswer {
  const p = ctx.analysis.byId[id];
  const t = ctx.analysis.trials[id];
  const lead =
    t.decision === "HOLD"
      ? `${id} is on Hold: ${holdReason(t).replace(/\.$/, "")}. ${t.reasons[0]}`
      : `${id} is marked ${decisionTitle(t.decision)} — ${ACTION_VERB[t.recommendedAction].toLowerCase()}. ${t.reasons[0]}`;
  return base("explain", `Why ${decisionTitle(t.decision)}?`, lead + historyCaveat(p), [...evidenceStatements(p, t), ...estimateStatement(t)], caseLinks(id, t), {
    customerId: id,
    comparison: { rows: rowsFor(t, [t.recommendedAction, "no_action", bestAlternative(t)?.action].filter(Boolean) as ActionId[]), hypothetical: false, changes: [] },
  });
}

function bestAlternative(t: TrialResult): ScenarioResult | undefined {
  return t.scenarios.filter((s) => s.eligible && s.action !== "no_action" && s.action !== t.recommendedAction).sort((a, b) => b.incrementalContribution - a.incrementalContribution)[0];
}

function rowReason(t: TrialResult, a: ActionId): string {
  if (a === t.recommendedAction) return t.decision === "HOLD" ? `Recommended: ${holdReason(t)}.` : `Recommended. ${t.reasons[0]}`;
  return t.rejected.find((r) => r.action === a)?.reason ?? "";
}

function rowsFor(t: TrialResult, actions: ActionId[], saved?: TrialResult): ComparisonRow[] {
  const uniq = [...new Set(actions)];
  return uniq.map((a) => {
    const s = scenario(t, a);
    return {
      action: a,
      label: ACTION_LABEL[a],
      eligible: s.eligible,
      recommended: a === t.recommendedAction,
      incremental: s.incrementalContribution,
      low: s.incrementalLow,
      high: s.incrementalHigh,
      cost: s.totalCost,
      savedIncremental: saved ? scenario(saved, a).incrementalContribution : undefined,
      reason: rowReason(t, a),
      dependsOnAssumptions: a !== "no_action",
    };
  });
}

function whyNotAnswer(ctx: CopilotContext, id: string, action: ActionId): CopilotAnswer {
  const t = ctx.analysis.trials[id];
  const s = scenario(t, action);
  const summary =
    action === t.recommendedAction
      ? `${ACTION_LABEL[action]} is the current recommendation for ${id}. ${t.reasons[0]}`
      : `${ACTION_LABEL[action]} is not recommended for ${id}. ${rowReason(t, action)}`;
  const notes: Statement[] = s.notes.map((n) => ({ kind: "indicator", text: n }));
  if (!s.eligible && s.ineligibleReason) notes.unshift({ kind: "rule", text: s.ineligibleReason });
  return base("why_not", `Why not ${ACTION_SHORT[action].toLowerCase()}?`, summary, [...notes, ...estimateStatement(t)], caseLinks(id, t), {
    customerId: id,
    comparison: { rows: rowsFor(t, [t.recommendedAction, action, "no_action"]), hypothetical: false, changes: [] },
  });
}

function missingAnswer(ctx: CopilotContext, id: string): CopilotAnswer {
  const p = ctx.analysis.byId[id];
  const t = ctx.analysis.trials[id];
  const st: Statement[] = [
    ...t.unknowns.map((u) => ({ kind: "unknown" as const, text: u })),
    ...p.limitations.map((l) => ({ kind: "indicator" as const, text: l })),
  ];
  const level = p.evidenceLevel === "high" ? "plenty of" : p.evidenceLevel === "medium" ? "a reasonable amount of" : "little";
  return base(
    "missing",
    "What we don't know",
    `REGAIN has ${level} purchase history for ${id} (evidence score ${p.evidenceScore.toFixed(2)} — a measure of data, not of the chance of success). The biggest gap: the effect of any action is an assumption until a randomised holdout test measures it.${historyCaveat(p)}`,
    st,
    caseLinks(id, t),
    { customerId: id },
  );
}

function planAnswer(ctx: CopilotContext, id: string): CopilotAnswer {
  const p = ctx.analysis.byId[id];
  const t = ctx.analysis.trials[id];
  const steps: string[] = [];
  if (t.suppression) {
    steps.push(`Do not contact ${id}: ${t.reasons[0]}`);
    if (p.openServiceIssue) steps.push("Resolve the recorded complaint through your normal customer-service process — that is not marketing contact.");
    steps.push("Nothing else to do in REGAIN until the restriction no longer applies.");
  } else if (t.decision === "HOLD") {
    steps.push("No contact for now — the evidence or the expected value doesn't justify it.");
    if (p.openServiceIssue) steps.push("Resolve the recorded complaint through normal customer service regardless of this marketing decision.");
    steps.push("Re-check this customer after the next data refresh.");
  } else {
    if (t.recommendedAction === "service_recovery") steps.push("Fix the recorded service problem first; hold all promotions until it is resolved.");
    steps.push(`Open Conversation Studio and generate the ${ACTION_SHORT[t.recommendedAction].toLowerCase()} draft. Check every statement against the record.`);
    steps.push("Approve only after review. In this prototype, sends and replies are simulated — nothing is delivered.");
    if (t.decision === "UNDERSTAND") steps.push("Record the reply. Don't offer discounts until the reason for the change is known.");
    steps.push("Measure: include the customer in a holdout experiment on Impact & Experiments to learn whether the action actually helped.");
  }
  return base("plan", "Next-step plan", `Plan for ${id} (${decisionTitle(t.decision)}). These steps follow REGAIN's decision and rules; the Copilot doesn't approve or send anything.`, steps.map((text) => ({ kind: "step", text })), [...caseLinks(id, t), { label: "Impact & Experiments", href: "/impact" }], { customerId: id });
}

/* -------------------------------------------- B. Recovery Trial what-if / compare */

function compareAnswer(q: string, ctx: CopilotContext, id: string, acts: ActionId[]): CopilotAnswer {
  const t = ctx.analysis.trials[id];
  const all = [t.recommendedAction, ...acts, "no_action" as ActionId, ...t.scenarios.filter((s) => s.action !== "no_action").sort((a, b) => b.incrementalContribution - a.incrementalContribution).map((s) => s.action)];
  const rows = rowsFor(t, all);
  const best = t.scenarios.filter((s) => s.eligible && s.action !== "no_action").sort((a, b) => b.incrementalContribution - a.incrementalContribution)[0];
  const rec = scenario(t, t.recommendedAction);
  let summary: string;
  if (/\bbest\b|highest|most/.test(q)) {
    summary = !best
      ? `No contact action is eligible for ${id}${t.suppression ? ` — ${t.reasons[0]}` : ""}.`
      : best.action === t.recommendedAction
        ? `${best.label} has the best estimated incremental contribution among eligible actions (${fmtMoney(best.incrementalContribution, 2)}) and is the recommendation.`
        : `${best.label} has the highest estimate on paper (${fmtMoney(best.incrementalContribution, 2)}), but REGAIN recommends ${ACTION_LABEL[t.recommendedAction].toLowerCase()}: ${rowReason(t, best.action)}`;
  } else if (acts.includes("no_action") || acts.length === 0) {
    summary =
      t.recommendedAction === "no_action"
        ? `Doing nothing is already the recommendation for ${id}. ${t.reasons[0]}`
        : `Doing nothing costs nothing and keeps the baseline purchase chance of ${fmtPct(rec.baselineProb)}. ${ACTION_LABEL[t.recommendedAction]} is estimated to add ${fmtMoney(rec.incrementalContribution, 2)} over that (range ${fmtMoney(rec.incrementalLow, 2)} to ${fmtMoney(rec.incrementalHigh, 2)}).`;
  } else {
    const other = scenario(t, acts.find((a) => a !== t.recommendedAction) ?? acts[0]);
    summary =
      other.action === t.recommendedAction
        ? `${other.label} is the current recommendation (${fmtMoney(other.incrementalContribution, 2)} estimated incremental contribution).`
        : `${ACTION_LABEL[t.recommendedAction]}: ${t.recommendedAction === "no_action" ? "no cost" : `${fmtMoney(rec.incrementalContribution, 2)} estimated`}. ${other.label}: ${other.eligible ? `${fmtMoney(other.incrementalContribution, 2)} estimated` : "not eligible"}. ${rowReason(t, other.action)}`;
  }
  return base("compare", "Recovery Trial comparison", summary, [{ kind: "estimate", text: "Contribution figures come from the Recovery Trial using your saved assumptions. Action effects are assumptions until a randomised test measures them." }], caseLinks(id, t), {
    customerId: id,
    comparison: { rows, hypothetical: false, changes: [] },
  });
}

export interface WhatIfSpec {
  assumptions: Assumptions;
  changes: string[];
  hypotheticalComplaint: boolean;
}

const pct = (s: string) => {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(%|percent|pp|per ?cent)/);
  return m ? Number(m[1]) / 100 : null;
};

/** Parses supported what-if changes. Returns null when nothing safely calculable was asked. */
export function parseWhatIf(q: string, a: Assumptions): WhatIfSpec | null {
  const next: Assumptions = structuredClone(a);
  const changes: string[] = [];
  const named = actionsIn(q).filter((x) => x !== "no_action") as Exclude<ActionId, "no_action">[];
  const v = pct(q);
  if (/\b(uplift|lift|effect|effectiveness)\b/.test(q) && named.length && v !== null) {
    const k = named[0];
    next.actions[k].upliftPp = clamp(v, 0, 0.3);
    changes.push(`${ACTION_LABEL[k]} assumed lift ${fmtPp(a.actions[k].upliftPp)} → ${fmtPp(next.actions[k].upliftPp)}`);
  } else if (/\bdiscount|% off\b/.test(q) && (v !== null || /\b(reduce|lower|smaller|less|cut|halve)\b/.test(q) || /\b(increase|raise|bigger|more|double)\b/.test(q))) {
    const cur = a.actions.discount.discountRate;
    const target = v !== null ? v : /\b(increase|raise|bigger|more|double)\b/.test(q) ? cur * 2 : cur / 2;
    next.actions.discount.discountRate = clamp(Math.round(target * 1000) / 1000, 0, 0.5);
    changes.push(`Discount rate ${fmtPct(cur, 1)} → ${fmtPct(next.actions.discount.discountRate, 1)}${v === null ? " (no value given — used " + (target > cur ? "double" : "half") + " the current rate)" : ""}`);
  }
  if (/\bmargin\b/.test(q) && v !== null) {
    next.marginRate = clamp(v, 0.1, 0.8);
    changes.push(`Contribution margin ${fmtPct(a.marginRate)} → ${fmtPct(next.marginRate)}`);
  }
  const h = q.match(/\b(horizon|window)\b.*?(\d{2,3})\s*days?|(\d{2,3})\s*days?.*\b(horizon|window)\b/);
  if (h) {
    next.horizonDays = clamp(Number(h[2] ?? h[3]), 30, 180);
    changes.push(`Horizon ${a.horizonDays} → ${next.horizonDays} days`);
  }
  const hypotheticalComplaint = /\b(complaint|service (issue|problem)|unresolved)\b/.test(q);
  if (!changes.length && !hypotheticalComplaint) return null;
  return { assumptions: next, changes, hypotheticalComplaint };
}

/** Runs a what-if through the existing Recovery Trial. Saved assumptions are not touched. */
export function runWhatIf(ctx: CopilotContext, id: string, spec: WhatIfSpec): TrialResult {
  const p = ctx.analysis.byId[id];
  const profile: CustomerProfile =
    spec.hypotheticalComplaint && !p.openServiceIssue ? { ...p, openServiceIssue: { orderId: "hypothetical", date: p.lastOrderDate, issue: "hypothetical unresolved complaint" } } : p;
  // Consent, opt-out, declines and frequency caps are re-evaluated from the real record — never from the question.
  return runTrial(profile, { assumptions: spec.assumptions, interventions: ctx.state.interventions, asOf: ctx.state.asOf, suppressedUntil: ctx.state.suppressedUntil });
}

function whatIfUnsupported(ctx: CopilotContext, id: string): CopilotAnswer {
  return base(
      "unsupported",
      "What-if not supported",
      "I can't calculate that scenario safely with the current engine, so I won't guess. Supported what-ifs: a different discount rate (e.g. “what if the discount is 10%?”), an action's assumed lift (“what if the reminder lift is 3%?”), the contribution margin, the horizon in days, or a hypothetical unresolved complaint.",
      [],
      caseLinks(id, ctx.analysis.trials[id]),
      { customerId: id },
    );
}

function whatIfAnswer(ctx: CopilotContext, id: string, spec: WhatIfSpec): CopilotAnswer {
  const saved = ctx.analysis.trials[id];
  const p = ctx.analysis.byId[id];
  const r = runWhatIf(ctx, id, spec);
  const changes = [...spec.changes];
  if (spec.hypotheticalComplaint) changes.push(p.openServiceIssue ? "Complaint: already recorded for this customer — the real record is used" : "Hypothetical: an unresolved complaint is recorded (not in the data)");
  const same = r.decision === saved.decision && r.recommendedAction === saved.recommendedAction;
  const verdict = same
    ? `The recommendation would stay ${decisionTitle(r.decision)} — ${ACTION_VERB[r.recommendedAction].toLowerCase()}.`
    : `The recommendation would change from ${decisionTitle(saved.decision)} (${ACTION_SHORT[saved.recommendedAction].toLowerCase()}) to ${decisionTitle(r.decision)} (${ACTION_SHORT[r.recommendedAction].toLowerCase()}).`;
  const summary = `What-if for ${id}: ${changes.join("; ")}. ${verdict} ${r.reasons[0] ?? ""} Your saved assumptions and the saved recommendation are unchanged.`;
  const st: Statement[] = [{ kind: "rule", text: "Consent, opt-out, declines and contact limits are taken from the real record. A what-if cannot change them." }];
  if (r.suppression) st.push({ kind: "rule", text: r.reasons[0] });
  if (spec.hypotheticalComplaint && !p.openServiceIssue) st.push({ kind: "explanation", text: "This complaint is hypothetical. No complaint is on record for this customer." });
  let proposal: AssumptionProposal | undefined;
  if (spec.changes.length) {
    const next = analyse({ transactions: ctx.state.transactions, interventions: ctx.state.interventions, asOf: ctx.state.asOf, assumptions: spec.assumptions, suppressedUntil: ctx.state.suppressedUntil });
    const decisionsChanged = Object.keys(next.trials).filter((k) => {
      const a = next.trials[k], b = ctx.analysis.trials[k];
      return !b || a.decision !== b.decision || a.recommendedAction !== b.recommendedAction;
    }).length;
    proposal = { assumptions: spec.assumptions, baseJson: JSON.stringify(ctx.state.assumptions), changes: spec.changes, note: `Decision Copilot (confirmed by user): ${spec.changes.join("; ")}.`, decisionsChanged };
  }
  return base("what_if", "What-if (not saved)", summary, st, caseLinks(id, saved), {
    customerId: id,
    comparison: { rows: rowsFor(r, [r.recommendedAction, saved.recommendedAction, "no_action", ...r.scenarios.map((s) => s.action)], saved), hypothetical: true, changes },
    proposal,
  });
}

/** The ONLY path from a Copilot answer to saved state: an explicit, user-confirmed proposal.
 * Returns null if the saved assumptions changed since the preview was computed. */
export function proposalAction(proposal: AssumptionProposal, current: Assumptions, at: string): AppAction | null {
  if (JSON.stringify(current) !== proposal.baseJson) return null;
  return { type: "SET_ASSUMPTIONS", assumptions: proposal.assumptions, note: proposal.note, at };
}

/* ------------------------------------------------------- C. portfolio investigator */

function card(a: Analysis, id: string): CustomerCard {
  const p = a.byId[id];
  const t = a.trials[id];
  return {
    customerId: id,
    signal: signalText(p),
    decision: t.decision,
    action: t.recommendedAction,
    value: t.decision === "HOLD" ? null : scenario(t, t.recommendedAction).incrementalContribution,
    reason: t.decision === "HOLD" ? holdReason(t) : t.reasons[0],
  };
}

function cards(a: Analysis, ids: string[]) {
  return { cards: ids.slice(0, MAX_CARDS).map((id) => card(a, id)), total: ids.length };
}

const more = (n: number) => (n > MAX_CARDS ? ` Showing the first ${MAX_CARDS}.` : "");

export function portfolioAnswer(q: string, ctx: CopilotContext): CopilotAnswer {
  const a = ctx.analysis;
  const trials = Object.values(a.trials);
  const total = a.profiles.length;
  const dir = (decision?: Decision): CopilotLink => ({ label: "Customer Directory", href: decision ? `/customers?decision=${decision}` : "/customers" });
  const none = (title: string, what: string): CopilotAnswer => base("portfolio", title, `No customers match: ${what}. Checked all ${total} analysed customers.`, [], [dir()], { customers: { cards: [], total: 0 } });

  if (/\b(complaints?|service (issue|problem)s?)\b/.test(q)) {
    const ids = a.profiles.filter((p) => p.openServiceIssue).map((p) => p.customerId).sort((x, y) => a.trials[y].priorityScore - a.trials[x].priorityScore);
    if (!ids.length) return none("Unresolved complaints", "an unresolved complaint on record");
    const contactable = ids.filter((id) => !a.trials[id].suppression).length;
    return base("portfolio", "Unresolved complaints", `${ids.length} of ${total} customers have a recorded complaint not marked resolved. ${contactable} can be contacted; the rest are blocked by consent or contact rules and should be handled through normal customer service.${more(ids.length)}`, [{ kind: "fact", text: "Only complaints recorded in the data are counted. A customer with no record may still have had a bad experience." }], [dir()], { customers: cards(a, ids) });
  }
  if (/\b(consent|opt.?out|opted|not allowed|blocked|suppress\w*)\b/.test(q)) {
    const ids = trials.filter((t) => t.suppression === "no_consent" || t.suppression === "opted_out").map((t) => t.customerId).sort();
    const s = a.suppressed;
    if (!ids.length) return none("Held because of consent", "held for missing consent or opt-out");
    return base("portfolio", "Held because of consent", `${ids.length} customers are held by consent rules: ${s.no_consent} without recorded marketing consent and ${s.opted_out} opted out. A further ${s.frequency_cap} are held by contact-frequency limits and ${s.declined} because they declined.${more(ids.length)}`, [{ kind: "rule", text: "Missing consent is treated as no consent. These are hard rules — no estimate or instruction can override them." }], [dir("HOLD"), { label: "Responsible AI & Audit", href: "/responsible" }], { customers: cards(a, ids) });
  }
  if (/\b(negative|lose money|losing|loss|unprofitable)\b/.test(q)) {
    const acting = trials.filter((t) => t.decision !== "HOLD");
    const neg = acting.filter((t) => scenario(t, t.recommendedAction).incrementalContribution < 0).map((t) => t.customerId);
    const lowNeg = acting.filter((t) => scenario(t, t.recommendedAction).incrementalLow < 0).map((t) => t.customerId).sort((x, y) => scenario(a.trials[x], a.trials[x].recommendedAction).incrementalLow - scenario(a.trials[y], a.trials[y].recommendedAction).incrementalLow);
    const summary = neg.length
      ? `${neg.length} of ${acting.length} recommended actions have a negative central estimate.`
      : `None of the ${acting.length} recommended actions has a negative central estimate — REGAIN holds instead of recommending an action expected to lose money. ${lowNeg.length} have a range whose low end is below zero, so they could lose money if the assumed effect is optimistic.${more(lowNeg.length)}`;
    return base("portfolio", "Negative estimated contribution", summary, [{ kind: "estimate", text: "Ranges come from the evidence-based uncertainty band on each action's assumed effect." }], [dir()], { customers: cards(a, neg.length ? neg : lowNeg) });
  }
  if (/\b(held|hold|holding)\b/.test(q)) {
    const holds = trials.filter((t) => t.decision === "HOLD");
    if (!holds.length) return none("Reasons for Hold", "a Hold decision");
    const groups = new Map<string, string[]>();
    for (const t of holds) groups.set(holdReason(t), [...(groups.get(holdReason(t)) ?? []), t.customerId]);
    const sorted = [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
    return base(
      "portfolio",
      "Why customers are held",
      `${holds.length} of ${total} customers are on Hold. The most common reason: ${sorted[0][0].toLowerCase()} (${sorted[0][1].length}).`,
      sorted.map(([reason, ids]) => ({ kind: "indicator", text: `${reason}: ${ids.length} customer${ids.length === 1 ? "" : "s"} (e.g. ${ids.slice(0, 2).join(", ")}).` })),
      [dir("HOLD")],
      { customers: cards(a, sorted.map(([, ids]) => ids[0])) },
    );
  }
  if (/\b(gap|rhythm|overdue|changed|slipp\w*|lapsed|drift\w*)\b/.test(q)) {
    const ids = a.profiles.filter((p) => p.rhythmSource === "personal" && p.gapZScore !== null && p.gapZScore >= 3).sort((x, y) => (y.overdueRatio ?? 0) - (x.overdueRatio ?? 0)).map((p) => p.customerId);
    if (!ids.length) return none("Buying gap changed significantly", "a current gap at least 3 robust deviations above their usual rhythm");
    return base("portfolio", "Buying gap changed significantly", `${ids.length} customers with a personal buying rhythm have a current gap at least 3 robust deviations above their own usual gaps (robust z ≥ 3), sorted by how overdue they are.${more(ids.length)}`, [{ kind: "unknown", text: "A longer gap does not show why the customer stopped. Inactivity alone does not mean they are unhappy." }, { kind: "rule", text: "The z ≥ 3 cut-off is the Copilot's search filter, not a decision rule." }], [dir()], { customers: cards(a, ids) });
  }
  if (/\b(weak\w*|least evidence|limited evidence|uncertain\w*|least confident)\b/.test(q)) {
    const ids = trials.filter((t) => t.decision !== "HOLD").map((t) => t.customerId).sort((x, y) => a.byId[x].evidenceScore - a.byId[y].evidenceScore);
    if (!ids.length) return none("Weakest evidence", "an active Recover or Understand decision");
    const low = ids.filter((id) => a.byId[id].evidenceLevel === "low").length;
    return base("portfolio", "Decisions on the weakest evidence", `Of ${ids.length} active decisions, ${low} rest on limited purchase history. Listed from weakest evidence score.${more(ids.length)}`, [{ kind: "indicator", text: "The evidence score measures how much purchase history supports the estimate — not the chance of success." }], [dir()], { customers: cards(a, ids) });
  }
  // Default: who to review first — the same priority ordering as the Command Centre.
  const ids = trials.filter((t) => t.decision !== "HOLD").sort((x, y) => y.priorityScore - x.priorityScore).map((t) => t.customerId);
  if (!ids.length) return none("Who to review first", "a Recover or Understand decision");
  return base("portfolio", "Who to review first", `${ids.length} of ${total} customers need attention (${a.counts.RECOVER} Recover, ${a.counts.UNDERSTAND} Understand). Ranked by estimated incremental contribution of the recommended action.${more(ids.length)}`, [{ kind: "estimate", text: "Ranking values are estimates from editable assumptions, not measured results." }], [dir()], { customers: cards(a, ids) });
}

function needCustomer(ctx: CopilotContext): CopilotAnswer {
  const top = Object.values(ctx.analysis.trials).filter((t) => t.decision !== "HOLD").sort((x, y) => y.priorityScore - x.priorityScore).slice(0, 3).map((t) => t.customerId);
  return base("need_customer", "Choose a customer", "That question is about one customer, but no customer is selected. Pick one below, type a customer ID, or ask a portfolio question such as “Who should I review first?”", [], [{ label: "Customer Directory", href: "/customers" }], { customers: cards(ctx.analysis, top) });
}

/* --------------------------------------------------- D. experiment & impact interpreter */

export function experimentAnswer(q: string, ctx: CopilotContext, customerId: string | null): CopilotAnswer {
  const exps = ctx.state.experiments;
  const historical = analyseHistorical(ctx.state.interventions);
  const wantId = q.match(/\bexp-\d+\b/)?.[0]?.toUpperCase();
  const wantPast = /\b(past|imported|historical|previous|may-\d+)\b/.test(q);
  const exp = wantId ? exps.find((e) => e.id === wantId) : !wantPast ? exps[0] : undefined;
  // A named experiment that doesn't exist must not fall back to a different result.
  const hist = !exp && !wantId && (wantPast || !exps.length) ? historical[0] : undefined;
  const synthetic = ctx.state.dataSource === "sample";
  const links: CopilotLink[] = [{ label: "Impact & Experiments", href: "/impact" }];
  if (!exp && !hist)
    return base("experiment", "No experiment to interpret", wantId ? `There is no experiment called ${wantId}.` : "No experiments or imported campaigns with a control group exist yet, so there is no result to interpret. Create a holdout experiment on Impact & Experiments.", [], links);

  let sum: ExperimentSummary;
  if (exp) {
    const m = computeImpact(exp);
    const observed = m.treatment.observed + m.control.observed;
    const evidence = m.sources.includes("simulated") ? "simulated" : observed === 0 ? "pending" : "randomised";
    sum = {
      title: `${exp.id} · ${exp.name}`,
      evidence,
      verdict: verdictOf(observed, m.diffCi),
      treatment: { n: m.treatment.observed, purchases: m.treatment.purchases, rate: m.treatment.rate },
      control: { n: m.control.observed, purchases: m.control.purchases, rate: m.control.rate },
      diffPp: m.diffPp,
      ci: m.diffCi,
      pValue: m.pValue,
      pending: m.treatment.pending + m.control.pending,
      incrementalContribution: observed ? m.incrementalContribution : null,
      requiredPerArm: m.requiredPerArm,
      syntheticData: synthetic,
    };
  } else {
    const h = hist!;
    sum = {
      title: `${h.campaign} — ${ACTION_LABEL[h.action as ActionId] ?? h.action}`,
      evidence: "observed_unverified",
      verdict: verdictOf(h.treatment.n + h.control.n, h.diffCi),
      treatment: { n: h.treatment.n, purchases: h.treatment.purchases, rate: h.treatment.purchases / h.treatment.n },
      control: { n: h.control.n, purchases: h.control.purchases, rate: h.control.purchases / h.control.n },
      diffPp: h.diffPp,
      ci: h.diffCi,
      pValue: h.pValue,
      pending: 0,
      incrementalContribution: null,
      requiredPerArm: null,
      syntheticData: synthetic,
    };
  }
  const st = experimentStatements(sum);
  if (customerId && exp) {
    const mem = exp.members.find((x) => x.customerId === customerId);
    const o = exp.outcomes[customerId];
    if (mem) st.push({ kind: o?.source === "simulated" ? "simulated" : "fact", text: `${customerId} is in the ${mem.group} group${o && o.purchased !== null ? `; outcome: ${o.purchased ? "purchased" : "no purchase"}${o.source === "simulated" ? " (simulated, not a real purchase)" : ""}` : "; outcome pending"}.` });
  }
  return base("experiment", "Experiment result", experimentSummaryText(sum, q), st, links, { experiment: sum, customerId: customerId ?? undefined });
}

function verdictOf(observed: number, ci: [number, number]): ExperimentSummary["verdict"] {
  if (!observed) return "no_data";
  if (ci[0] > 0) return "positive";
  if (ci[1] < 0) return "negative";
  return "inconclusive";
}

export function experimentSummaryText(s: ExperimentSummary, q = ""): string {
  if (s.verdict === "no_data") return `${s.title}: no outcomes are recorded yet${s.pending ? ` (${s.pending} customers pending)` : ""}, so there is nothing to compare. Pending customers are never counted as recoveries.`;
  const parts: string[] = [];
  if (s.evidence === "simulated") parts.push("These outcomes are SIMULATED from REGAIN's own assumptions — they are not real purchases and are not evidence of real impact.");
  parts.push(
    `Treatment customers bought again ${fmtPct(s.treatment.rate, 1)} of the time (${s.treatment.purchases} of ${s.treatment.n}) versus ${fmtPct(s.control.rate, 1)} for control (${s.control.purchases} of ${s.control.n}) — a difference of ${fmtPp(s.diffPp)}.`,
  );
  const ci = `95% interval ${fmtPp(s.ci[0])} to ${fmtPp(s.ci[1])}`;
  if (s.verdict === "inconclusive") parts.push(`The ${ci} includes zero, so the result is inconclusive: it could be chance, and the data are consistent with no effect.`);
  else if (s.verdict === "positive") parts.push(`The ${ci} is above zero, so chance alone is an unlikely explanation.`);
  else parts.push(`The ${ci} is below zero: the action appears to have lowered repeat purchases.`);
  if (s.evidence === "observed_unverified") parts.push("REGAIN can't verify how these groups were assigned, so this does not prove the action caused the difference.");
  if (s.evidence === "randomised" && s.verdict !== "inconclusive") parts.push("Groups were assigned at random by REGAIN, so the difference estimates the action's effect — within the interval shown.");
  if (s.syntheticData && s.evidence !== "simulated") parts.push("Measured on the synthetic demo dataset (fictional customers).");
  if (s.incrementalContribution !== null && /\b(worth|cost|value|money|contribution)\b/.test(q || "worth"))
    parts.push(`Estimated incremental contribution after costs: ${fmtMoney(s.incrementalContribution, 2)}${s.evidence === "simulated" ? " (simulated)" : ""}${s.verdict === "inconclusive" ? " — but because the result is inconclusive, the true value could be zero or negative" : ""}.`);
  return parts.join(" ");
}

function experimentStatements(s: ExperimentSummary): Statement[] {
  const k: StatementKind = s.evidence === "simulated" ? "simulated" : "fact";
  const st: Statement[] = [
    { kind: k, text: `Treatment: ${s.treatment.purchases} of ${s.treatment.n} bought again (${fmtPct(s.treatment.rate, 1)}).` },
    { kind: k, text: `Control: ${s.control.purchases} of ${s.control.n} bought again (${fmtPct(s.control.rate, 1)}).` },
    { kind: "indicator", text: `Difference ${fmtPp(s.diffPp)}; 95% interval ${fmtPp(s.ci[0])} to ${fmtPp(s.ci[1])}${s.pValue !== null ? `; p = ${s.pValue.toFixed(3)}` : ""}.` },
  ];
  if (s.pending) st.push({ kind: "unknown", text: `${s.pending} customers are pending and excluded — not counted as recoveries.` });
  if (s.treatment.n < 100 || s.control.n < 100) st.push({ kind: "unknown", text: `Small sample (${s.treatment.n} treatment / ${s.control.n} control). Differences this size can easily arise by chance.` });
  if (s.requiredPerArm && Number.isFinite(s.requiredPerArm)) st.push({ kind: "indicator", text: `To detect a difference this size reliably (80% power, 5% significance) needs about ${s.requiredPerArm} customers per group.` });
  st.push({
    kind: "rule",
    text:
      s.evidence === "observed_unverified"
        ? "The Copilot never updates estimates from a conversation. To use this result, choose “Update the estimate with this result” on Impact & Experiments."
        : "The Copilot never updates estimates from a conversation. Simulated results cannot be used to update estimates.",
  });
  return st;
}

/* ------------------------------------------------------------- rules and limits */

function policyRefusal(ctx: CopilotContext, id: string | null): CopilotAnswer {
  const st: Statement[] = [];
  if (id) {
    const t = ctx.analysis.trials[id];
    st.push(t.suppression ? { kind: "rule", text: `${id}: ${t.reasons[0]}` } : { kind: "rule", text: `${id} is currently allowed to be contacted under the rules.` });
  }
  return base(
    "policy_refusal",
    "Hard rules can't be changed here",
    "Consent, opt-out, declines and contact-frequency limits are hard rules in REGAIN. A what-if cannot change them, and no instruction in this chat can override them. Consent and opt-out come only from your customer records.",
    st,
    [{ label: "Responsible AI & Audit", href: "/responsible" }, { label: "Contact limits (Settings)", href: "/data#contact" }],
    { customerId: id ?? undefined },
  );
}

function notAllowed(q: string, id: string | null): CopilotAnswer {
  const msg = /\b(message|draft|send)\b/.test(q)
    ? { text: "I can't approve or send messages. Review and approve drafts yourself in Conversation Studio. In this prototype, sends and replies are simulated — nothing is delivered.", link: { label: "Conversation Studio", href: id ? `/studio?id=${id}` : "/studio", customerId: id ?? undefined } }
    : /\b(outcomes?|experiment)\b/.test(q)
      ? { text: "I can't record outcomes or change experiments. Do that on Impact & Experiments, where every change is labelled and audited.", link: { label: "Impact & Experiments", href: "/impact" } }
      : { text: "I can't import, reset or delete data. Use Data & Integrations, which asks for confirmation.", link: { label: "Data & Integrations", href: "/data" } };
  return base("not_allowed", "That needs you, not the Copilot", msg.text, [], [msg.link], { customerId: id ?? undefined });
}

/* ------------------------------------------------------------ suggested prompts */

export function suggestedPrompts(path: string, customer: { id: string; trial: TrialResult; profile: CustomerProfile } | null): string[] {
  const impact = ["Did this campaign work?", "Could this result be due to chance?", "Was the action worth its cost?", "What additional data would make this result more reliable?"];
  const portfolio = ["Who should I review first?", "Why are customers being held?", "Show customers with unresolved complaints.", "Summarise the latest experiment.", "Which decisions rely on the weakest evidence?"];
  if (path.startsWith("/impact")) return impact;
  if (!customer) return portfolio;
  const { trial: t, profile: p } = customer;
  const out = ["Explain this recommendation.", "Compare it with doing nothing.", t.recommendedAction === "discount" ? "Which alternative has the best estimated incremental contribution?" : "Why not offer a discount?", "What evidence is missing?", "Draft a next-step plan."];
  if (path.startsWith("/trial")) out.splice(2, 0, "What if I reduce the discount to 10%?");
  out.push(p.openServiceIssue ? "How does the complaint affect the options?" : "What if the customer had an unresolved complaint?");
  return out;
}
