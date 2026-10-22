// Application state as a pure reducer (persisted to localStorage by the React provider).
import type { ConversationState, Channel, Tone } from "./conversation";
import { autoMap, IV_FIELDS, parseCsvText, TX_FIELDS, validateInterventions, validateTransactions, type ImportReport } from "./csv";
import type { Experiment, Outcome } from "./experiment";
import { generateSample, IV_HEADERS, rowsToCsv, SAMPLE_AS_OF, SAMPLE_BUSINESS, TX_HEADERS } from "./sampleData";
import { DEFAULT_ASSUMPTIONS } from "./trial";
import type { Assumptions, InterventionRecord, Transaction } from "./types";
import { addDays } from "./utils";

export const STORAGE_KEY = "regain:v1";

export interface AuditEntry {
  id: number;
  at: string; // wall-clock timestamp
  type:
    | "data_loaded"
    | "data_reset"
    | "assumptions_changed"
    | "decision_viewed"
    | "message_approved"
    | "message_rejected"
    | "response_simulated"
    | "suppressed"
    | "experiment_created"
    | "outcomes_recorded"
    | "assumption_calibrated"
    | "settings_changed";
  customerId?: string;
  detail: string;
}

export interface ImportSummary {
  fileName: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  excludedColumns: { column: string; reason: string }[];
  optionalMissing: string[];
}

export interface AppState {
  version: 1;
  dataSource: "sample" | "upload" | "empty";
  businessName: string;
  tone: Tone;
  channel: Channel;
  benefitDescription: string;
  transactions: Transaction[];
  interventions: InterventionRecord[];
  asOf: string;
  assumptions: Assumptions;
  experiments: Experiment[];
  conversations: Record<string, ConversationState>;
  suppressedUntil: Record<string, string>;
  audit: AuditEntry[];
  importSummary?: ImportSummary;
  /** Customer currently being worked on across Trial / Studio pages. */
  selectedCustomerId?: string;
}

export type AppAction =
  | { type: "LOAD_SAMPLE"; at: string }
  | { type: "CLEAR_ALL"; at: string }
  | { type: "IMPORT_TRANSACTIONS"; records: Transaction[]; asOf: string; summary: ImportSummary; at: string }
  | { type: "IMPORT_INTERVENTIONS"; records: InterventionRecord[]; fileName: string; at: string }
  | { type: "SET_ASSUMPTIONS"; assumptions: Assumptions; note: string; at: string }
  | { type: "RESET_ASSUMPTIONS"; at: string }
  | { type: "SET_SETTINGS"; patch: Partial<Pick<AppState, "businessName" | "tone" | "channel" | "benefitDescription" | "asOf">>; at: string }
  | { type: "SELECT_CUSTOMER"; customerId: string }
  | { type: "SAVE_CONVERSATION"; conv: ConversationState }
  | { type: "RECORD_SEND"; customerId: string; action: string; at: string; detail: string }
  | { type: "SUPPRESS"; customerId: string; days: number; at: string }
  | { type: "AUDIT"; entry: Omit<AuditEntry, "id"> }
  | { type: "CREATE_EXPERIMENT"; experiment: Experiment; at: string }
  | { type: "SET_OUTCOMES"; experimentId: string; outcomes: Record<string, Outcome>; note: string; at: string }
  | { type: "DELETE_EXPERIMENT"; experimentId: string; at: string }
  | { type: "HYDRATE"; state: AppState };

const MAX_AUDIT = 500;

function withAudit(s: AppState, entry: Omit<AuditEntry, "id">): AppState {
  const top = s.audit[0];
  // Coalesce repeated slider edits of the same setting into one entry.
  const key = (d: string) => (d.includes(" set to ") ? d.split(" set to ")[0] : null);
  if (top && top.type === entry.type && key(top.detail) !== null && key(top.detail) === key(entry.detail)) {
    return { ...s, audit: [{ ...top, ...entry, id: top.id }, ...s.audit.slice(1)] };
  }
  const id = (top?.id ?? 0) + 1;
  return { ...s, audit: [{ id, ...entry }, ...s.audit].slice(0, MAX_AUDIT) };
}

/** Builds the sample through the same CSV validation path that uploads use. */
export function loadSampleData(): { transactions: Transaction[]; interventions: InterventionRecord[]; txReport: ImportReport<Transaction> } {
  const { transactions, interventions } = generateSample();
  const txParsed = parseCsvText(rowsToCsv(TX_HEADERS, transactions));
  const txReport = validateTransactions(txParsed, autoMap(txParsed.headers, TX_FIELDS));
  const ivParsed = parseCsvText(rowsToCsv(IV_HEADERS, interventions));
  const ivReport = validateInterventions(ivParsed, autoMap(ivParsed.headers, IV_FIELDS));
  return { transactions: txReport.records, interventions: ivReport.records, txReport };
}

export function emptyState(): AppState {
  return {
    version: 1,
    dataSource: "empty",
    businessName: "Your business",
    tone: "warm",
    channel: "email",
    benefitDescription: "a free grind-to-order upgrade",
    transactions: [],
    interventions: [],
    asOf: SAMPLE_AS_OF,
    assumptions: structuredClone(DEFAULT_ASSUMPTIONS),
    experiments: [],
    conversations: {},
    suppressedUntil: {},
    audit: [],
  };
}

export function sampleState(at: string): AppState {
  const { transactions, interventions, txReport } = loadSampleData();
  const s: AppState = {
    ...emptyState(),
    dataSource: "sample",
    businessName: SAMPLE_BUSINESS.replace(" (fictional)", ""),
    transactions,
    interventions,
    asOf: SAMPLE_AS_OF,
    importSummary: {
      fileName: "Synthetic sample (generated)",
      totalRows: txReport.totalRows,
      acceptedRows: txReport.acceptedRows,
      rejectedRows: txReport.rejectedRows,
      duplicateRows: txReport.duplicateRows,
      excludedColumns: txReport.excludedColumns,
      optionalMissing: txReport.optionalMissing,
    },
  };
  return withAudit(s, { at, type: "data_loaded", detail: `Loaded SYNTHETIC sample: ${transactions.length} transaction lines, ${interventions.length} intervention records.` });
}

export function appReducer(s: AppState, a: AppAction): AppState {
  switch (a.type) {
    case "HYDRATE":
      return a.state;
    case "LOAD_SAMPLE":
      return withAudit(sampleState(a.at), { at: a.at, type: "data_reset", detail: "Reset to synthetic sample data. Previous experiments, conversations and suppressions cleared." });
    case "CLEAR_ALL":
      return withAudit(emptyState(), { at: a.at, type: "data_reset", detail: "All data cleared." });
    case "IMPORT_TRANSACTIONS":
      return withAudit(
        { ...emptyState(), dataSource: "upload", businessName: s.businessName === SAMPLE_BUSINESS.replace(" (fictional)", "") ? "Your business" : s.businessName, tone: s.tone, channel: s.channel, benefitDescription: s.benefitDescription, assumptions: s.assumptions, transactions: a.records, asOf: a.asOf, importSummary: a.summary, audit: s.audit },
        { at: a.at, type: "data_loaded", detail: `Imported ${a.records.length} transaction lines from "${a.summary.fileName}" (${a.summary.rejectedRows} rejected, ${a.summary.duplicateRows} duplicates removed).` },
      );
    case "IMPORT_INTERVENTIONS":
      return withAudit({ ...s, interventions: [...s.interventions.filter((r) => r.source === "app"), ...a.records] }, { at: a.at, type: "data_loaded", detail: `Imported ${a.records.length} intervention records from "${a.fileName}".` });
    case "SET_ASSUMPTIONS":
      return withAudit({ ...s, assumptions: a.assumptions }, { at: a.at, type: "assumptions_changed", detail: a.note });
    case "RESET_ASSUMPTIONS":
      return withAudit({ ...s, assumptions: structuredClone(DEFAULT_ASSUMPTIONS) }, { at: a.at, type: "assumptions_changed", detail: "Assumptions reset to defaults." });
    case "SET_SETTINGS":
      return withAudit({ ...s, ...a.patch }, { at: a.at, type: "settings_changed", detail: `Settings changed: ${Object.keys(a.patch).join(", ")}.` });
    case "SELECT_CUSTOMER":
      return { ...s, selectedCustomerId: a.customerId };
    case "SAVE_CONVERSATION":
      return { ...s, conversations: { ...s.conversations, [a.conv.customerId]: a.conv } };
    case "RECORD_SEND": {
      // A simulated send counts as a contact for frequency caps from the analysis date onward.
      const rec: InterventionRecord = { customerId: a.customerId, date: s.asOf, action: a.action, group: "treatment", purchased: "unknown", optedOut: "no", campaign: "REGAIN studio (simulated)", source: "app" };
      return withAudit({ ...s, interventions: [...s.interventions, rec] }, { at: a.at, type: "message_approved", customerId: a.customerId, detail: a.detail });
    }
    case "SUPPRESS":
      return withAudit(
        { ...s, suppressedUntil: { ...s.suppressedUntil, [a.customerId]: addDays(s.asOf, a.days) } },
        { at: a.at, type: "suppressed", customerId: a.customerId, detail: `Suppressed for ${a.days} days after the customer declined.` },
      );
    case "AUDIT":
      return withAudit(s, a.entry);
    case "CREATE_EXPERIMENT":
      return withAudit({ ...s, experiments: [a.experiment, ...s.experiments] }, { at: a.at, type: "experiment_created", detail: `Experiment "${a.experiment.name}" created: ${a.experiment.members.length} customers, ${Math.round(a.experiment.holdoutShare * 100)}% holdout, seed "${a.experiment.seed}".` });
    case "SET_OUTCOMES":
      return withAudit(
        { ...s, experiments: s.experiments.map((e) => (e.id === a.experimentId ? { ...e, outcomes: { ...e.outcomes, ...a.outcomes } } : e)) },
        { at: a.at, type: "outcomes_recorded", detail: a.note },
      );
    case "DELETE_EXPERIMENT":
      return withAudit({ ...s, experiments: s.experiments.filter((e) => e.id !== a.experimentId) }, { at: a.at, type: "outcomes_recorded", detail: `Experiment ${a.experimentId} deleted.` });
  }
}

/** Validate a persisted blob before trusting it. */
export function isAppState(x: unknown): x is AppState {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.version === 1 && Array.isArray(o.transactions) && Array.isArray(o.interventions) && typeof o.asOf === "string" && typeof o.assumptions === "object" && Array.isArray(o.audit);
}
