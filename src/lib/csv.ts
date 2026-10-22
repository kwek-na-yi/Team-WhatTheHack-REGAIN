// CSV ingestion: parsing, column mapping, validation, duplicate detection, missing-value handling.
// Imported files are treated as untrusted input: values are sanitised, sizes are capped and
// columns that look like sensitive personal attributes or direct identifiers are discarded.
import Papa from "papaparse";
import type { InterventionRecord, Transaction, YesNoUnknown } from "./types";
import { isIsoDate, sanitizeText } from "./utils";

export const MAX_ROWS = 50_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type TxField =
  | "customer_id"
  | "date"
  | "value"
  | "order_id"
  | "category"
  | "service_issue"
  | "issue_resolved"
  | "marketing_consent"
  | "opted_out";

export type IvField = "customer_id" | "date" | "action" | "group" | "purchased" | "opted_out" | "campaign";

export const TX_FIELDS: { field: TxField; label: string; required: boolean; synonyms: string[] }[] = [
  { field: "customer_id", label: "Customer ID", required: true, synonyms: ["customer_id", "customerid", "customer", "cust_id", "client_id", "member_id", "user_id"] },
  { field: "date", label: "Transaction date", required: true, synonyms: ["date", "transaction_date", "order_date", "purchase_date", "txn_date", "invoice_date"] },
  { field: "value", label: "Transaction value", required: true, synonyms: ["value", "amount", "total", "order_value", "transaction_value", "revenue", "sales", "price"] },
  { field: "order_id", label: "Order ID", required: false, synonyms: ["order_id", "orderid", "invoice", "invoice_no", "invoice_id", "transaction_id", "receipt_id"] },
  { field: "category", label: "Product / service category", required: false, synonyms: ["category", "product_category", "service", "product_type", "department"] },
  { field: "service_issue", label: "Customer-service issue", required: false, synonyms: ["service_issue", "complaint", "issue", "ticket", "support_issue"] },
  { field: "issue_resolved", label: "Issue resolved", required: false, synonyms: ["issue_resolved", "resolved", "ticket_resolved", "complaint_resolved"] },
  { field: "marketing_consent", label: "Marketing consent", required: false, synonyms: ["marketing_consent", "consent", "opt_in", "optin", "marketing_opt_in"] },
  { field: "opted_out", label: "Opted out", required: false, synonyms: ["opted_out", "opt_out", "optout", "unsubscribed", "do_not_contact"] },
];

export const IV_FIELDS: { field: IvField; label: string; required: boolean; synonyms: string[] }[] = [
  { field: "customer_id", label: "Customer ID", required: true, synonyms: ["customer_id", "customerid", "customer", "cust_id"] },
  { field: "date", label: "Intervention date", required: true, synonyms: ["date", "intervention_date", "sent_date", "contact_date"] },
  { field: "action", label: "Action", required: true, synonyms: ["action", "intervention", "treatment", "message_type"] },
  { field: "group", label: "Group (treatment/control)", required: false, synonyms: ["group", "arm", "variant", "assignment"] },
  { field: "purchased", label: "Purchased within window", required: false, synonyms: ["purchased", "outcome", "converted", "purchased_30d", "returned"] },
  { field: "opted_out", label: "Opted out after contact", required: false, synonyms: ["opted_out", "opt_out", "unsubscribed"] },
  { field: "campaign", label: "Campaign", required: false, synonyms: ["campaign", "campaign_id", "experiment"] },
];

/** Columns we refuse to ingest: sensitive attributes must not influence customer worth,
 * and direct identifiers are unnecessary for the analysis (data minimisation). */
const SENSITIVE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /(^|_)(gender|sex|race|ethnicity|ethnic|religion|religious|nationality|citizenship|marital|disability|health|medical|pregnancy|sexuality|orientation|political|union|age|age_group|birthday|birth|dob|date_of_birth|income)($|_)/i, reason: "sensitive personal attribute" },
  { re: /(e_?mail|phone|mobile|address|postal|postcode|zip|nric|passport|ssn|first_?name|last_?name|full_?name|^name$|customer_name|ip_addr)/i, reason: "direct personal identifier" },
];

export type DateFormat = "auto" | "ymd" | "dmy" | "mdy";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  parseErrors: string[];
  truncated: boolean;
}

export function parseCsvText(text: string): ParsedCsv {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => sanitizeText(h, 60),
  });
  const headers = (res.meta.fields ?? []).filter((h) => h.length > 0);
  const truncated = res.data.length > MAX_ROWS;
  return {
    headers,
    rows: truncated ? res.data.slice(0, MAX_ROWS) : res.data,
    parseErrors: res.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`),
    truncated,
  };
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s\-.]+/g, "_");
}

export function classifyExcludedColumns(headers: string[]): { column: string; reason: string }[] {
  const out: { column: string; reason: string }[] = [];
  for (const h of headers) {
    const n = normaliseHeader(h);
    // Allow our own known field names even if they partially match (e.g. "usage" contains "age").
    if (TX_FIELDS.some((f) => f.synonyms.includes(n)) || IV_FIELDS.some((f) => f.synonyms.includes(n))) continue;
    const hit = SENSITIVE_PATTERNS.find((p) => p.re.test(n));
    if (hit) out.push({ column: h, reason: hit.reason });
  }
  return out;
}

export function autoMap<F extends string>(
  headers: string[],
  fields: { field: F; synonyms: string[] }[],
): Partial<Record<F, string>> {
  const excluded = new Set(classifyExcludedColumns(headers).map((e) => e.column));
  const mapping: Partial<Record<F, string>> = {};
  const used = new Set<string>();
  for (const f of fields) {
    const hit = headers.find((h) => !used.has(h) && !excluded.has(h) && f.synonyms.includes(normaliseHeader(h)));
    if (hit) {
      mapping[f.field] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

export function parseDate(raw: string, fmt: DateFormat = "auto"): { date: string | null; ambiguous: boolean } {
  const s = sanitizeText(raw, 40);
  if (!s) return { date: null, ambiguous: false };
  const iso = s.slice(0, 10);
  if ((fmt === "auto" || fmt === "ymd") && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return { date: isIsoDate(iso) ? iso : null, ambiguous: false };
  }
  const m = s.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/);
  if (!m) return { date: null, ambiguous: false };
  let [a, b, c] = [m[1], m[2], m[3]];
  let y: string, mo: string, d: string;
  let ambiguous = false;
  if (a.length === 4) {
    [y, mo, d] = [a, b, c];
  } else if (fmt === "mdy") {
    [mo, d, y] = [a, b, c];
  } else {
    // Default to day-first (Singapore / UK convention) and flag when both readings are valid.
    [d, mo, y] = [a, b, c];
    if (fmt === "auto" && Number(a) <= 12 && Number(b) <= 12 && a !== b) ambiguous = true;
  }
  if (y.length === 2) y = "20" + y;
  const out = `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return { date: isIsoDate(out) ? out : null, ambiguous };
}

export function parseMoney(raw: string): number | null {
  const s = sanitizeText(raw, 40).replace(/[$,\sA-Za-z]/g, "");
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseYesNo(raw: string | undefined): YesNoUnknown {
  const s = sanitizeText(raw ?? "", 20).toLowerCase();
  if (!s) return "unknown";
  if (["yes", "y", "true", "1", "opted_in", "opt_in", "granted", "subscribed"].includes(s)) return "yes";
  if (["no", "n", "false", "0", "denied", "withdrawn", "none"].includes(s)) return "no";
  return "unknown";
}

export interface RowIssue {
  row: number; // 1-based data row number as shown in a spreadsheet (header = row 1)
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ImportReport<T> {
  records: T[];
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  issues: RowIssue[];
  missingFilled: Record<string, number>;
  excludedColumns: { column: string; reason: string }[];
  unmappedRequired: string[];
  ambiguousDates: number;
  truncated: boolean;
  optionalPresent: string[];
  optionalMissing: string[];
}

const MAX_ISSUES = 300;

export function validateTransactions(
  parsed: ParsedCsv,
  mapping: Partial<Record<TxField, string>>,
  dateFormat: DateFormat = "auto",
): ImportReport<Transaction> {
  const issues: RowIssue[] = [];
  const push = (i: RowIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(i);
  };
  const unmappedRequired = TX_FIELDS.filter((f) => f.required && !mapping[f.field]).map((f) => f.label);
  const optionalPresent = TX_FIELDS.filter((f) => !f.required && mapping[f.field]).map((f) => f.label);
  const optionalMissing = TX_FIELDS.filter((f) => !f.required && !mapping[f.field]).map((f) => f.label);
  const base = {
    totalRows: parsed.rows.length,
    excludedColumns: classifyExcludedColumns(parsed.headers),
    truncated: parsed.truncated,
    optionalPresent,
    optionalMissing,
  };
  if (unmappedRequired.length) {
    return { ...base, records: [], acceptedRows: 0, rejectedRows: parsed.rows.length, duplicateRows: 0, issues, missingFilled: {}, unmappedRequired, ambiguousDates: 0 };
  }
  const get = (r: Record<string, string>, f: TxField) => (mapping[f] ? r[mapping[f] as string] ?? "" : "");
  const records: Transaction[] = [];
  const seen = new Set<string>();
  const orderOwner = new Map<string, string>();
  const missingFilled: Record<string, number> = {};
  let rejected = 0;
  let duplicates = 0;
  let ambiguousDates = 0;

  parsed.rows.forEach((r, idx) => {
    const row = idx + 2;
    const customerId = sanitizeText(get(r, "customer_id"), 40);
    const { date, ambiguous } = parseDate(get(r, "date"), dateFormat);
    const value = parseMoney(get(r, "value"));
    let bad = false;
    if (!customerId) {
      push({ row, field: "customer_id", message: "Missing customer ID — row excluded", severity: "error" });
      bad = true;
    }
    if (!date) {
      push({ row, field: "date", message: `Invalid or missing date "${sanitizeText(get(r, "date"), 20)}" — row excluded`, severity: "error" });
      bad = true;
    }
    if (value === null) {
      push({ row, field: "value", message: `Invalid or missing value "${sanitizeText(get(r, "value"), 20)}" — row excluded`, severity: "error" });
      bad = true;
    } else if (value <= 0) {
      push({ row, field: "value", message: "Zero or negative value (refunds are not modelled in this version) — row excluded", severity: "error" });
      bad = true;
    } else if (value > 1_000_000) {
      push({ row, field: "value", message: "Implausibly large value — row excluded", severity: "error" });
      bad = true;
    }
    if (bad) {
      rejected++;
      return;
    }
    if (ambiguous) ambiguousDates++;
    let category = sanitizeText(get(r, "category"), 60);
    if (!category) {
      category = "Uncategorised";
      if (mapping.category) missingFilled["category"] = (missingFilled["category"] ?? 0) + 1;
    }
    let orderId = sanitizeText(get(r, "order_id"), 60);
    if (!orderId) {
      orderId = `${customerId}@${date}`;
      if (mapping.order_id) missingFilled["order_id"] = (missingFilled["order_id"] ?? 0) + 1;
    }
    const owner = orderOwner.get(orderId);
    if (owner && owner !== customerId) {
      push({ row, field: "order_id", message: `Order ${orderId} already belongs to another customer — row excluded`, severity: "error" });
      rejected++;
      return;
    }
    orderOwner.set(orderId, customerId);
    const serviceIssue = sanitizeText(get(r, "service_issue"), 100) || undefined;
    const key = [customerId, orderId, date, value, category, serviceIssue ?? ""].join("|");
    if (seen.has(key)) {
      duplicates++;
      push({ row, field: "*", message: "Exact duplicate of an earlier row — removed", severity: "warning" });
      return;
    }
    seen.add(key);
    records.push({
      customerId,
      orderId,
      date: date as string,
      value: Math.round((value as number) * 100) / 100,
      category,
      serviceIssue: serviceIssue && !/^(none|n\/a|na|-)$/i.test(serviceIssue) ? serviceIssue : undefined,
      serviceIssueResolved: mapping.issue_resolved ? parseYesNo(get(r, "issue_resolved")) : undefined,
      marketingConsent: mapping.marketing_consent ? parseYesNo(get(r, "marketing_consent")) : undefined,
      optedOut: mapping.opted_out ? parseYesNo(get(r, "opted_out")) : undefined,
    });
  });
  if (ambiguousDates > 0) {
    push({ row: 0, field: "date", message: `${ambiguousDates} dates could be read as day/month or month/day; interpreted as day-first. Change the date format if this is wrong.`, severity: "warning" });
  }
  return { ...base, records, acceptedRows: records.length, rejectedRows: rejected, duplicateRows: duplicates, issues, missingFilled, unmappedRequired, ambiguousDates };
}

function normaliseAction(raw: string): string {
  const s = sanitizeText(raw, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (/check/.test(s)) return "check_in";
  if (/remind|replen/.test(s)) return "reminder";
  if (/service|apolog|recovery/.test(s)) return "service_recovery";
  if (/benefit|perk|early|priority/.test(s)) return "benefit";
  if (/discount|voucher|coupon|promo|incentive/.test(s)) return "discount";
  if (/none|control|holdout|no_action/.test(s)) return "none";
  return s || "unknown";
}

export function validateInterventions(
  parsed: ParsedCsv,
  mapping: Partial<Record<IvField, string>>,
  dateFormat: DateFormat = "auto",
): ImportReport<InterventionRecord> {
  const issues: RowIssue[] = [];
  const unmappedRequired = IV_FIELDS.filter((f) => f.required && !mapping[f.field]).map((f) => f.label);
  const base = {
    totalRows: parsed.rows.length,
    excludedColumns: classifyExcludedColumns(parsed.headers),
    truncated: parsed.truncated,
    optionalPresent: IV_FIELDS.filter((f) => !f.required && mapping[f.field]).map((f) => f.label),
    optionalMissing: IV_FIELDS.filter((f) => !f.required && !mapping[f.field]).map((f) => f.label),
    missingFilled: {},
    ambiguousDates: 0,
  };
  if (unmappedRequired.length) {
    return { ...base, records: [], acceptedRows: 0, rejectedRows: parsed.rows.length, duplicateRows: 0, issues, unmappedRequired };
  }
  const get = (r: Record<string, string>, f: IvField) => (mapping[f] ? r[mapping[f] as string] ?? "" : "");
  const records: InterventionRecord[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  let duplicates = 0;
  parsed.rows.forEach((r, idx) => {
    const row = idx + 2;
    const customerId = sanitizeText(get(r, "customer_id"), 40);
    const { date } = parseDate(get(r, "date"), dateFormat);
    if (!customerId || !date) {
      if (issues.length < MAX_ISSUES) issues.push({ row, field: !customerId ? "customer_id" : "date", message: "Missing customer ID or invalid date — row excluded", severity: "error" });
      rejected++;
      return;
    }
    const action = normaliseAction(get(r, "action"));
    const g = sanitizeText(get(r, "group"), 20).toLowerCase();
    const group: InterventionRecord["group"] = /control|holdout/.test(g) || action === "none" ? "control" : /treat|test/.test(g) ? "treatment" : g ? "unknown" : action === "none" ? "control" : "treatment";
    const campaign = sanitizeText(get(r, "campaign"), 60) || "Unlabelled";
    const key = [customerId, date, action, campaign].join("|");
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);
    records.push({ customerId, date, action, group, purchased: parseYesNo(get(r, "purchased")), optedOut: parseYesNo(get(r, "opted_out")), campaign, source: "imported" });
  });
  return { ...base, records, acceptedRows: records.length, rejectedRows: rejected, duplicateRows: duplicates, issues, unmappedRequired };
}

export function toCsv(headers: string[], rows: (string | number)[][], safe: (v: string | number) => string): string {
  return [headers.join(","), ...rows.map((r) => r.map(safe).join(","))].join("\n");
}
