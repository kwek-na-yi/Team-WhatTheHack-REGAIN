// Guardrails for the OPTIONAL language-model rewording of a Copilot answer.
// 1. buildModelFacts: the only data that may leave the browser — derived, verified sentences with
//    customer IDs pseudonymised and free-text complaint wording removed. No raw records, no CSV.
// 2. validateModelText: rejects any rewording that introduces numbers not in the facts, claims proof
//    or certainty, drops a simulation disclosure, or infers feelings. Rejected output is discarded
//    and the deterministic summary is shown instead.
import { STATEMENT_LABEL, type CopilotAnswer } from "./copilot";
import { fmtMoney, fmtPct, fmtPp } from "./utils";

export const MAX_FACTS = 24;
export const MAX_FACT_LEN = 280;
export const MAX_MODEL_TEXT = 900;

export interface ModelFacts {
  title: string;
  facts: string[];
  /** True when any fact concerns simulated outcomes — the rewording must keep saying so. */
  simulated: boolean;
}

/** Removes customer IDs (replaced by neutral labels) and quoted free text such as complaint wording. */
export function redact(text: string, ids: string[], otherIds: string[] = []): string {
  let out = text;
  // Longest first so an ID that prefixes another is not partially replaced.
  const labelled = ids.map((id, i) => [id, `Customer ${String.fromCharCode(65 + (i % 26))}`] as const);
  const rest = otherIds.filter((x) => !ids.includes(x)).map((id) => [id, "another customer"] as const);
  for (const [id, label] of [...labelled, ...rest].sort((x, y) => y[0].length - x[0].length)) out = out.split(id).join(label);
  return out
    .replace(/"[^"]*"/g, "[recorded text withheld]")
    .replace(/“[^”]*”/g, "[recorded text withheld]")
    .replace(/[<>]/g, "");
}

/** `allIds`: every customer ID in the dataset, so IDs mentioned only in passing are removed too. */
export function buildModelFacts(a: CopilotAnswer, allIds: string[] = []): ModelFacts {
  const ids = [a.customerId, ...(a.customers?.cards.map((c) => c.customerId) ?? [])].filter((x): x is string => !!x);
  const uniq = [...new Set(ids)];
  const facts: string[] = [a.summary];
  for (const s of a.statements) facts.push(`${STATEMENT_LABEL[s.kind]}: ${s.text}`);
  for (const r of a.comparison?.rows ?? [])
    facts.push(`${r.label}: ${r.eligible ? `estimated incremental contribution ${fmtMoney(r.incremental, 2)} (range ${fmtMoney(r.low, 2)} to ${fmtMoney(r.high, 2)}), cost ${fmtMoney(r.cost, 2)}` : "not eligible"}${r.recommended ? "; recommended" : ""}.`);
  for (const c of a.customers?.cards ?? []) facts.push(`${c.customerId}: ${c.decision}, ${c.action.replace("_", " ")}${c.value !== null ? `, estimated ${fmtMoney(c.value, 2)}` : ""}.`);
  if (a.customers) facts.push(`Matching customers: ${a.customers.total}.`);
  const e = a.experiment;
  if (e) facts.push(`Experiment evidence: ${e.evidence}; verdict ${e.verdict}; treatment ${fmtPct(e.treatment.rate, 1)}, control ${fmtPct(e.control.rate, 1)}, difference ${fmtPp(e.diffPp)}, 95% interval ${fmtPp(e.ci[0])} to ${fmtPp(e.ci[1])}.`);
  const clean = facts.map((f) => redact(f, uniq, allIds).slice(0, MAX_FACT_LEN)).slice(0, MAX_FACTS);
  return { title: redact(a.title, uniq, allIds).slice(0, 80), facts: clean, simulated: a.experiment?.evidence === "simulated" || a.statements.some((s) => s.kind === "simulated") };
}

/** Parses an untrusted request body into ModelFacts (server side). */
export function parseModelFacts(body: unknown): ModelFacts | null {
  if (!body || typeof body !== "object") return null;
  const f = (body as { facts?: unknown }).facts as Partial<ModelFacts> | undefined;
  if (!f || typeof f.title !== "string" || !Array.isArray(f.facts) || !f.facts.length) return null;
  if (!f.facts.every((x) => typeof x === "string")) return null;
  return {
    title: f.title.replace(/[<>]/g, "").slice(0, 80),
    facts: (f.facts as string[]).slice(0, MAX_FACTS).map((x) => x.replace(/[<>]/g, "").slice(0, MAX_FACT_LEN)),
    simulated: f.simulated === true,
  };
}

const numbersIn = (s: string) => (s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));

export function validateModelText(text: unknown, facts: ModelFacts): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof text !== "string") return { ok: false, reason: "no text" };
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, reason: "empty" };
  if (t.length > MAX_MODEL_TEXT) return { ok: false, reason: "too long" };
  const allowed = new Set(facts.facts.flatMap(numbersIn).concat(numbersIn(facts.title)));
  const bad = numbersIn(t).filter((n) => !allowed.has(n));
  if (bad.length) return { ok: false, reason: `unsupported number(s): ${bad.slice(0, 3).join(", ")}` };
  for (const m of t.matchAll(/\b(prove[sdn]?|proof|guarantee[sd]?|definitely|certainly|causal(ly)?)\b/gi)) {
    const before = t.slice(Math.max(0, (m.index ?? 0) - 14), m.index).toLowerCase();
    if (!/\bnot\b|n't|\bno\b|\bcannot\b/.test(before)) return { ok: false, reason: `overstated claim: "${m[0]}"` };
  }
  const allFacts = facts.facts.join(" ").toLowerCase();
  for (const w of ["unhappy", "dissatisfied", "angry", "frustrated", "churned"]) if (t.toLowerCase().includes(w) && !allFacts.includes(w)) return { ok: false, reason: `unsupported inference: "${w}"` };
  if (facts.simulated && !/simulat/i.test(t)) return { ok: false, reason: "dropped the simulation disclosure" };
  return { ok: true, text: t };
}

/** Puts the real customer IDs back into a validated rewording (the model only ever saw labels). */
export function restoreIds(text: string, a: CopilotAnswer): string {
  const ids = [...new Set([a.customerId, ...(a.customers?.cards.map((c) => c.customerId) ?? [])].filter((x): x is string => !!x))];
  return ids.reduce((s, id, i) => s.split(`Customer ${String.fromCharCode(65 + (i % 26))}`).join(id), text);
}
