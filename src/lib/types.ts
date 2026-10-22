// Core domain types for REGAIN. All dates are ISO "YYYY-MM-DD" strings (UTC calendar days).

export type YesNoUnknown = "yes" | "no" | "unknown";

/** One cleaned transaction line (after validation). */
export interface Transaction {
  customerId: string;
  orderId: string; // synthesised from customer+date when not supplied
  date: string;
  value: number;
  category: string;
  /** Free-text service issue recorded against this order, if any. */
  serviceIssue?: string;
  serviceIssueResolved?: YesNoUnknown;
  /** Customer-level fields; the latest non-empty row wins. */
  marketingConsent?: YesNoUnknown;
  optedOut?: YesNoUnknown;
}

/** A recorded historical (or app-simulated) intervention and its observed outcome. */
export interface InterventionRecord {
  customerId: string;
  date: string;
  action: string; // e.g. "reminder", "discount", "check_in", "none"
  group: "treatment" | "control" | "unknown";
  /** Did the customer purchase within the outcome window? */
  purchased: YesNoUnknown;
  optedOut: YesNoUnknown;
  campaign: string;
  /** "imported" = from the dataset; "app" = a simulated send recorded inside REGAIN. */
  source: "imported" | "app";
}

export interface Order {
  orderId: string;
  date: string;
  value: number;
  categories: string[];
  serviceIssue?: string;
  serviceIssueResolved?: YesNoUnknown;
}

export type RhythmSource = "personal" | "provisional" | "population" | "none";

export type BehaviourStatus =
  | "on_rhythm"
  | "slipping"
  | "lapsed"
  | "dormant"
  | "new"
  | "insufficient_history";

export type EvidenceKind = "fact" | "indicator" | "explanation" | "unknown";

export interface EvidenceItem {
  kind: EvidenceKind;
  text: string;
}

export interface CustomerProfile {
  customerId: string;
  orders: Order[];
  orderCount: number;
  firstOrderDate: string;
  lastOrderDate: string;
  recencyDays: number;
  tenureDays: number;
  totalSpend: number;
  /** Median order value — robust to one-off large orders. */
  typicalOrderValue: number;
  meanOrderValue: number;
  outlierOrderIds: string[];
  intervals: number[];
  medianInterval: number | null;
  /** Robust coefficient of variation of intervals (1.4826*MAD/median). */
  intervalCv: number | null;
  /** Interval used for the expected rhythm (personal, or population fallback). */
  expectedInterval: number | null;
  rhythmSource: RhythmSource;
  /** recency / expectedInterval. */
  overdueRatio: number | null;
  /** Robust z-score of current gap vs the customer's own intervals. */
  gapZScore: number | null;
  ordersPer90Days: number;
  spendLast180: number;
  spendPrior180: number;
  /** (recent - prior) / prior, or null when prior is 0. */
  spendTrend: number | null;
  /** True when the last two intervals are clearly longer than earlier ones. */
  intervalsLengthening: boolean;
  topCategory: string;
  categoryShare: number;
  status: BehaviourStatus;
  openServiceIssue?: { orderId: string; date: string; issue: string };
  resolvedServiceIssues: number;
  marketingConsent: YesNoUnknown;
  optedOut: YesNoUnknown;
  evidence: EvidenceItem[];
  limitations: string[];
  /** 0..1 data-quality score for the behavioural estimate (not a probability). */
  evidenceScore: number;
  evidenceLevel: "high" | "medium" | "low";
}

export type ActionId = "check_in" | "reminder" | "service_recovery" | "benefit" | "discount" | "no_action";

export type Decision = "RECOVER" | "UNDERSTAND" | "HOLD";

export interface ActionAssumption {
  /** Absolute percentage-point uplift in purchase probability over the baseline. */
  upliftPp: number;
  /** Fixed cost of sending/handling the contact (staff time, messaging). */
  contactCost: number;
  /** Fixed cost of a benefit if redeemed (non-monetary benefit fulfilment). */
  benefitCost: number;
  /** Discount rate applied to the first returning order (0..1). */
  discountRate: number;
  /** Probability (pp) the contact causes an opt-out / complaint. */
  optOutRiskPp: number;
}

export interface Assumptions {
  horizonDays: number;
  marginRate: number; // contribution margin on revenue, 0..1
  /** Baseline purchase probability within the horizon by status (heuristic, not ML). */
  baseline: Record<"on_rhythm" | "slipping" | "lapsed" | "dormant" | "new", number>;
  actions: Record<Exclude<ActionId, "no_action">, ActionAssumption>;
  /** Estimated value lost when a customer opts out of marketing (future contribution). */
  optOutLoss: number;
  /** Minimum expected incremental contribution to justify contact. */
  minIncrementalContribution: number;
  /** Reminder uplift multiplier when the customer has no regular rhythm. */
  irregularReminderFactor: number;
  /** Minimum days since last contact. */
  minDaysBetweenContacts: number;
  /** Maximum contacts allowed in any rolling 90 days. */
  maxContactsPer90Days: number;
}

export interface ScenarioResult {
  action: ActionId;
  label: string;
  eligible: boolean;
  ineligibleReason?: string;
  baselineProb: number;
  actionProb: number;
  upliftPp: number;
  expectedOrders: number;
  ordersIfReturn: number;
  expectedRevenue: number;
  grossContribution: number;
  contactCost: number;
  benefitCost: number;
  discountCost: number;
  /** Discount paid to customers who would have bought anyway. */
  discountLeakage: number;
  experienceRiskCost: number;
  totalCost: number;
  netContribution: number;
  incrementalRevenue: number;
  incrementalContribution: number;
  incrementalLow: number;
  incrementalHigh: number;
  notes: string[];
}

export interface TrialResult {
  customerId: string;
  decision: Decision;
  recommendedAction: ActionId;
  headline: string;
  reasons: string[];
  rejected: { action: ActionId; reason: string }[];
  scenarios: ScenarioResult[];
  unknowns: string[];
  suppression?: "opted_out" | "no_consent" | "frequency_cap" | "declined";
  priorityScore: number;
  uncertaintyBand: number;
}
