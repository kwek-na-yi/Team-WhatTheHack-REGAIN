// ENGAGEMENT & JOURNEY — a read-only, derived view of each customer's recovery journey.
// Nothing here is stored or scheduled: every event is derived deterministically from records that
// already exist (transactions, imported contact records, Studio conversations, the audit log,
// experiments and the current Recovery Trial decision). Viewing it never contacts anyone.
//
// Event sources:
//   observed   — in the loaded data: transactions and imported contact records
//   recorded   — a person did this inside REGAIN (draft review, rejection, approval, experiment set-up)
//   simulated  — produced by the prototype's simulation: sends, customer replies, simulated outcomes
//   calculated — derived by REGAIN's formulas: the behavioural signal and the current decision
import type { Analysis } from "./analysis";
import { STATUS_THRESHOLDS } from "./behaviour";
import type { ConversationState, ResponseKind } from "./conversation";
import type { Experiment } from "./experiment";
import { contactStatus, type ContactStatus } from "./insights";
import { contactDates } from "./policy";
import type { AuditEntry } from "./store";
import { ACTION_LABEL } from "./trial";
import type { ActionId, Decision, InterventionRecord } from "./types";
import { addDays, daysBetween } from "./utils";

/** Days after a contact in which a purchase counts as "after the contact" (same as the sample campaign and Impact's default). */
export const OUTCOME_WINDOW_DAYS = 30;

export type EventSource = "observed" | "recorded" | "simulated" | "calculated";
export type EventType =
  | "signal"
  | "decision"
  | "drafted"
  | "rejected"
  | "approved"
  | "contact"
  | "holdout"
  | "response"
  | "opt_out"
  | "suppressed"
  | "override"
  | "experiment"
  | "outcome"
  | "purchase";

export const EVENT_LABEL: Record<EventType, string> = {
  signal: "Behavioural signal",
  decision: "Recovery decision",
  drafted: "Message drafted",
  rejected: "Draft rejected",
  approved: "Message approved",
  contact: "Contact recorded",
  holdout: "Not contacted (comparison group)",
  response: "Customer response",
  opt_out: "Opt-out recorded",
  suppressed: "Messages paused",
  override: "Hold overridden",
  experiment: "Added to a test",
  outcome: "Test result",
  purchase: "Purchase",
};

export const SOURCE_LABEL: Record<EventSource, string> = {
  observed: "From your data",
  recorded: "Done in REGAIN",
  simulated: "Simulated",
  calculated: "Worked out by REGAIN",
};

export const SOURCE_DEF: Record<EventSource, string> = {
  observed: "Comes straight from your sales or contact records.",
  recorded: "Someone did this in REGAIN, like approving or rejecting a message.",
  simulated: "Pretend — this demo doesn't send real messages or get real replies.",
  calculated: "REGAIN worked this out from your records.",
};

export interface JourneyEvent {
  id: string;
  customerId: string;
  journeyId: string | null;
  type: EventType;
  /** Data date (YYYY-MM-DD) when the record has one. */
  date: string | null;
  /** Wall-clock time when a person did this in REGAIN (from the audit log). */
  at: string | null;
  source: EventSource;
  detail: string;
  /** Related order, campaign, experiment or action. */
  ref?: string;
}

export type StageKey = "recommended" | "drafted" | "reviewed" | "approved" | "contacted" | "responded" | "purchased";
export const STAGES: { key: StageKey; label: string; help: string }[] = [
  { key: "recommended", label: "Suggested", help: "REGAIN suggests following up with this customer." },
  { key: "drafted", label: "Message written", help: "A message has been written in Conversation Studio, but not necessarily approved." },
  { key: "reviewed", label: "Checked", help: "A person approved or rejected the message." },
  { key: "approved", label: "Approved", help: "A person approved the message. In this demo it isn't really sent." },
  { key: "contacted", label: "Contacted", help: "The customer was messaged — a pretend send in REGAIN, or a contact in your imported records." },
  { key: "responded", label: "Replied", help: "The customer replied (pretend, in this demo) or unsubscribed. No reply doesn't mean they ignored it." },
  { key: "purchased", label: "Bought again", help: `They bought within ${OUTCOME_WINDOW_DAYS} days of being contacted. That doesn't prove the message caused it.` },
];

export type PurchaseStatus = "purchased" | "no_purchase" | "window_open" | "no_contact";
export const PURCHASE_LABEL: Record<PurchaseStatus, string> = {
  purchased: "Bought again",
  no_purchase: `Didn't buy within ${OUTCOME_WINDOW_DAYS} days`,
  window_open: "Too early to tell",
  no_contact: "Not contacted",
};

export interface PurchaseOutcome {
  status: PurchaseStatus;
  contactDate: string | null;
  windowEnd: string | null;
  purchaseDate?: string;
  daysToPurchase?: number;
  purchaseValue?: number;
}

export interface NextStep {
  text: string;
  kind: "review" | "wait" | "stop" | "measure" | "none";
  href: string | null;
}

export interface CustomerJourney {
  customerId: string;
  /** Primary REGAIN journey (see journeyIdFor). */
  journeyId: string;
  /** Every journey the customer belongs to (primary + imported campaigns + experiments). */
  journeyIds: string[];
  decision: Decision;
  recommendedAction: ActionId;
  contact: ContactStatus;
  reached: Record<StageKey, boolean>;
  /** Furthest stage reached, in funnel order; null if none. */
  stage: StageKey | null;
  contactSource: "simulated" | "observed" | null;
  contactRecords: number;
  response: { label: string; source: "simulated" | "observed"; negative: boolean } | null;
  purchase: PurchaseOutcome;
  /** Outcome recorded in an experiment, if any. */
  experimentOutcome: { purchased: boolean; source: "simulated" | "observed" } | null;
  conversationStatus: ConversationState["status"] | null;
  events: JourneyEvent[];
  lastActivity: JourneyEvent | null;
  next: NextStep;
  sources: EventSource[];
}

export type JourneyKind = "recovery" | "hold" | "imported" | "experiment";
export type JourneyStatus = "Active" | "Monitoring" | "Blocked" | "No follow-up needed" | "Finished (imported)" | "In progress (imported)" | "Waiting for results" | "Results in";

export interface Journey {
  id: string;
  name: string;
  kind: JourneyKind;
  trigger: string;
  action: string;
  customers: string[];
  status: JourneyStatus;
  lastActivity: JourneyEvent | null;
  contacted: number;
  responded: number;
  /** Purchase after contact among customers whose window has closed (observed). */
  outcome: { purchased: number; eligible: number; windowOpen: number } | null;
  /** Experiment outcomes, by source. */
  experiment?: { observed: number; simulated: number; purchased: number; pending: number };
  /** For imported campaigns: comparison-group customers (not contacted). */
  holdout?: number;
  sources: EventSource[];
}

export interface JourneySource {
  analysis: Analysis;
  interventions: InterventionRecord[];
  conversations: Record<string, ConversationState>;
  experiments: Experiment[];
  audit: AuditEntry[];
  asOf: string;
}

const RECOVERY_TRIGGER: Partial<Record<ActionId, string>> = {
  reminder: "Usually buys regularly, but is overdue.",
  service_recovery: "Has an unresolved complaint to fix first.",
  check_in: "Buying slowed — reason unknown, so ask first.",
  benefit: "A small thank-you is the best option.",
  discount: "A discount is the best option.",
};

const REPLY_LABEL: Record<ResponseKind, string> = {
  interested: "Interested (simulated)",
  not_interested: "Not interested (simulated)",
  service_problem: "Reported a service problem (simulated)",
  needs_info: "Asked for more information (simulated)",
};

/** Order of dated records on the same day. */
const PHASE: Record<EventType, number> = { signal: 0, purchase: 1, experiment: 2, holdout: 3, contact: 3, opt_out: 4, outcome: 5, decision: 6, override: 7, drafted: 8, rejected: 9, approved: 9, response: 9, suppressed: 9 };
/** Tie-break for undated app actions recorded at the same moment: an approval comes before the send it caused, then a reply. */
const APP_PHASE: Partial<Record<EventType, number>> = { override: 0, drafted: 1, rejected: 2, approved: 3, contact: 4, response: 5, suppressed: 6 };

export function compareEvents(asOf: string) {
  return (x: JourneyEvent, y: JourneyEvent) => {
    const dx = x.date ?? asOf, dy = y.date ?? asOf;
    if (dx !== dy) return dx < dy ? -1 : 1;
    // Undated app actions happen on the analysis date, after everything dated that day.
    const ux = x.date === null ? 1 : 0, uy = y.date === null ? 1 : 0;
    if (ux !== uy) return ux - uy;
    if (ux) {
      // Undated app actions: by recorded time (unrecorded times first, e.g. the draft), then by APP_PHASE.
      const ax = x.at ?? "", ay = y.at ?? "";
      if (ax !== ay) return ax < ay ? -1 : 1;
      const px = APP_PHASE[x.type] ?? 9, py = APP_PHASE[y.type] ?? 9;
      if (px !== py) return px - py;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    }
    if (PHASE[x.type] !== PHASE[y.type]) return PHASE[x.type] - PHASE[y.type];
    const ax = x.at ?? "", ay = y.at ?? "";
    if (ax !== ay) return ax < ay ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  };
}

/**
 * Primary journey, deterministically:
 *  1. the action of the customer's first simulated send in REGAIN, else
 *  2. the action of their Studio draft, else
 *  3. the current recommended action for Recover / Understand, else
 *  4. a Hold group: blocked by contact rules, or no contact needed.
 */
export function journeyIdFor(customerId: string, src: JourneySource): string {
  const appSend = src.interventions.find((r) => r.customerId === customerId && r.source === "app");
  if (appSend) return `regain:${appSend.action}`;
  const conv = src.conversations[customerId];
  if (conv && conv.action !== "no_action") return `regain:${conv.action}`;
  const t = src.analysis.trials[customerId];
  if (t.decision !== "HOLD") return `regain:${t.recommendedAction}`;
  return t.suppression ? "hold:blocked" : "hold:none";
}

const campaignId = (campaign: string) => `imported:${campaign}`;

/** First order strictly after the contact date and within the outcome window. */
function purchaseAfter(src: JourneySource, customerId: string, contactDate: string | null): PurchaseOutcome {
  if (!contactDate) return { status: "no_contact", contactDate: null, windowEnd: null };
  const windowEnd = addDays(contactDate, OUTCOME_WINDOW_DAYS);
  const p = src.analysis.byId[customerId];
  const next = p.orders.find((o) => o.date > contactDate && o.date <= windowEnd && o.date <= src.asOf);
  if (next) return { status: "purchased", contactDate, windowEnd, purchaseDate: next.date, daysToPurchase: daysBetween(contactDate, next.date), purchaseValue: next.value };
  return { status: windowEnd <= src.asOf ? "no_purchase" : "window_open", contactDate, windowEnd };
}

function eventsFor(customerId: string, src: JourneySource, journeyId: string): JourneyEvent[] {
  const { analysis, asOf } = src;
  const p = analysis.byId[customerId];
  const t = analysis.trials[customerId];
  const ev: JourneyEvent[] = [];
  const add = (e: Omit<JourneyEvent, "customerId">) => ev.push({ customerId, ...e });

  // Calculated: the day the gap passed the "slipping" threshold of the customer's own rhythm.
  if (p.rhythmSource !== "population" && p.expectedInterval && p.overdueRatio !== null && p.overdueRatio >= STATUS_THRESHOLDS.slipping) {
    const d = addDays(p.lastOrderDate, Math.ceil(STATUS_THRESHOLDS.slipping * p.expectedInterval));
    if (d <= asOf) add({ id: `${customerId}:signal`, journeyId, type: "signal", date: d, at: null, source: "calculated", detail: `Started buying less often than usual (normally every ${Math.round(p.expectedInterval)} days).` });
  }
  add({
    id: `${customerId}:decision`,
    journeyId,
    type: "decision",
    date: asOf,
    at: null,
    source: "calculated",
    detail: t.decision === "HOLD" ? "REGAIN suggests no follow-up for now." : `REGAIN suggests: ${ACTION_LABEL[t.recommendedAction]}.`,
    ref: t.recommendedAction,
  });

  // Imported contact records (observed).
  const imported = src.interventions.filter((r) => r.customerId === customerId && r.source === "imported");
  imported.forEach((r, i) => {
    const jid = campaignId(r.campaign);
    if (r.group === "control" || r.action === "none") add({ id: `${customerId}:imp${i}`, journeyId: jid, type: "holdout", date: r.date, at: null, source: "observed", detail: `Left out of “${r.campaign}” on purpose, for comparison.`, ref: r.campaign });
    else add({ id: `${customerId}:imp${i}`, journeyId: jid, type: "contact", date: r.date, at: null, source: "observed", detail: `${ACTION_LABEL[r.action as ActionId] ?? r.action} sent in “${r.campaign}”.`, ref: r.campaign });
    if (r.optedOut === "yes") add({ id: `${customerId}:imp${i}:opt`, journeyId: jid, type: "opt_out", date: r.date, at: null, source: "observed", detail: "Unsubscribed after this message.", ref: r.campaign });
  });

  // App actions from the audit log (wall-clock time; data date is the analysis date).
  const audit = src.audit.filter((a) => a.customerId === customerId).sort((a, b) => a.id - b.id);
  const sendTimes: (string | null)[] = [];
  for (const a of audit) {
    const base = { id: `${customerId}:audit${a.id}`, journeyId, date: null, at: a.at };
    if (a.type === "message_approved") {
      const initial = a.detail.startsWith("Approved & simulated send");
      if (initial) sendTimes.push(a.at);
      add({ ...base, type: "approved", source: "recorded", detail: initial ? "Someone checked and approved the message." : "Someone approved a follow-up reply." });
    } else if (a.type === "message_rejected") add({ ...base, type: "rejected", source: "recorded", detail: a.detail });
    else if (a.type === "response_simulated") add({ ...base, type: "response", source: "simulated", detail: a.detail });
    else if (a.type === "suppressed") add({ ...base, type: "suppressed", source: "recorded", detail: a.detail });
    else if (a.type === "decision_viewed" && /overrode HOLD/.test(a.detail)) add({ ...base, type: "override", source: "recorded", detail: a.detail });
  }
  // Simulated sends: the k-th app contact record pairs with the k-th approval-and-send audit entry.
  src.interventions
    .filter((r) => r.customerId === customerId && r.source === "app")
    .forEach((r, k) => add({ id: `${customerId}:send${k}`, journeyId, type: "contact", date: null, at: sendTimes[k] ?? null, source: "simulated", detail: `${ACTION_LABEL[r.action as ActionId] ?? r.action} sent (pretend — nothing was really delivered).`, ref: r.action }));

  // Draft: exists, but REGAIN does not record when it was created.
  const conv = src.conversations[customerId];
  if (conv) add({ id: `${customerId}:draft`, journeyId, type: "drafted", date: null, at: null, source: "recorded", detail: `${ACTION_LABEL[conv.action]} message written in Conversation Studio.`, ref: conv.action });

  // Experiments.
  for (const e of src.experiments) {
    const m = e.members.find((x) => x.customerId === customerId);
    if (!m) continue;
    const jid = `exp:${e.id}`;
    add({ id: `${customerId}:${e.id}`, journeyId: jid, type: "experiment", date: e.startDate, at: e.createdAt, source: "recorded", detail: `Added to test ${e.id} (${m.group === "control" ? "not messaged, for comparison" : "messaged group"}).`, ref: e.id });
    const o = e.outcomes[customerId];
    if (o && o.purchased !== null)
      add({ id: `${customerId}:${e.id}:out`, journeyId: jid, type: "outcome", date: addDays(e.startDate, e.windowDays), at: null, source: o.source === "simulated" ? "simulated" : o.source === "manual" ? "recorded" : "observed", detail: `${o.purchased ? "Bought" : "Didn't buy"} within ${e.windowDays} days${o.source === "simulated" ? " (pretend result)" : o.source === "manual" ? " (typed in by hand)" : ""}.`, ref: e.id });
  }

  // Purchases from 90 days before the first dated journey event (keeps the timeline focused).
  const dated = ev.filter((e) => e.date && e.type !== "decision").map((e) => e.date as string);
  const from = addDays(dated.length ? dated.reduce((a, b) => (a < b ? a : b)) : asOf, -90);
  for (const o of p.orders)
    if (o.date >= from && o.date <= asOf) add({ id: `${customerId}:order:${o.orderId}`, journeyId: null, type: "purchase", date: o.date, at: null, source: "observed", detail: `Spent $${o.value.toFixed(2)}${o.serviceIssue ? ` — complaint: ${o.serviceIssue}` : ""}.`, ref: o.orderId });

  return ev.sort(compareEvents(asOf));
}

function nextStepFor(j: Omit<CustomerJourney, "next">): NextStep {
  const id = j.customerId;
  const studio = `/studio?id=${id}`;
  // Hard rules first: never suggest contact for a blocked customer.
  if (!j.contact.allowed) {
    if (j.conversationStatus === "draft") return { text: `Don't send the message — ${j.contact.label.toLowerCase()}.`, kind: "stop", href: studio };
    return { text: `Don't contact — ${j.contact.label.toLowerCase()}.`, kind: "stop", href: null };
  }
  switch (j.conversationStatus) {
    case "draft": return { text: "Check the message and approve or reject it.", kind: "review", href: studio };
    case "rejected": return { text: "Fix the message, or leave this customer alone.", kind: "review", href: studio };
    case "awaiting_response": return { text: "Wait for their reply.", kind: "wait", href: studio };
    case "positive":
    case "info_requested": return { text: "Read their reply and answer it.", kind: "review", href: studio };
    case "service_issue": return { text: "Pass to customer service.", kind: "review", href: studio };
    case "declined": return { text: "Thank them and stop messaging.", kind: "review", href: studio };
    case "escalated": return { text: "Customer service is handling it.", kind: "none", href: null };
  }
  if (j.purchase.status === "window_open") return { text: `Check back after ${j.purchase.windowEnd}.`, kind: "wait", href: null };
  if (j.purchase.status === "purchased") return { text: "Bought again — check Impact before giving the message credit.", kind: "measure", href: "/impact" };
  if (j.purchase.status === "no_purchase" && j.decision !== "HOLD") return { text: "Didn't buy after the last message — look at the suggestion again.", kind: "review", href: `/trial?id=${id}` };
  if (j.decision !== "HOLD") return { text: "Look at the suggestion and write a message.", kind: "review", href: `/trial?id=${id}` };
  return { text: "Nothing to do.", kind: "none", href: null };
}

/** Derives every customer's journey. Pure and deterministic; never changes state. */
export function buildCustomerJourneys(src: JourneySource): CustomerJourney[] {
  const { analysis, asOf } = src;
  const overridden = new Set(src.audit.filter((a) => a.type === "decision_viewed" && /overrode HOLD/.test(a.detail) && a.customerId).map((a) => a.customerId as string));
  return analysis.profiles.map((p) => {
    const id = p.customerId;
    const t = analysis.trials[id];
    const conv = src.conversations[id] ?? null;
    const journeyId = journeyIdFor(id, src);
    const events = eventsFor(id, src, journeyId);
    const contacts = contactDates(id, src.interventions, asOf);
    const lastContact = contacts[contacts.length - 1] ?? null;
    const appSends = src.interventions.filter((r) => r.customerId === id && r.source === "app");
    const lastRecord = [...src.interventions].reverse().find((r) => r.customerId === id && r.group !== "control" && r.action !== "none" && r.date === lastContact);
    const importedOptOut = src.interventions.some((r) => r.customerId === id && r.source === "imported" && r.group !== "control" && r.optedOut === "yes");
    const audited = (type: AuditEntry["type"]) => src.audit.some((a) => a.customerId === id && a.type === type);
    const response = conv?.lastResponse
      ? { label: REPLY_LABEL[conv.lastResponse], source: "simulated" as const, negative: conv.lastResponse === "not_interested" }
      : importedOptOut
        ? { label: "Opted out (imported record)", source: "observed" as const, negative: true }
        : null;
    let experimentOutcome: CustomerJourney["experimentOutcome"] = null;
    for (const e of src.experiments) {
      const o = e.outcomes[id];
      if (o && o.purchased !== null) experimentOutcome = { purchased: o.purchased, source: o.source === "simulated" ? "simulated" : "observed" };
    }
    const purchase = purchaseAfter(src, id, lastContact);
    const reached: Record<StageKey, boolean> = {
      recommended: t.decision !== "HOLD" || (!!conv && !overridden.has(id)),
      drafted: !!conv,
      reviewed: (!!conv && (conv.sends > 0 || !!conv.rejectionReason)) || audited("message_approved") || audited("message_rejected"),
      approved: (!!conv && conv.sends > 0) || appSends.length > 0,
      contacted: contacts.length > 0,
      responded: !!response,
      purchased: purchase.status === "purchased",
    };
    const stage = [...STAGES].reverse().find((s) => reached[s.key])?.key ?? null;
    const journeyIds = [...new Set([journeyId, ...events.map((e) => e.journeyId).filter((x): x is string => !!x)])];
    const activity = events.filter((e) => e.type !== "decision" && e.type !== "signal");
    const base: Omit<CustomerJourney, "next"> = {
      customerId: id,
      journeyId,
      journeyIds,
      decision: t.decision,
      recommendedAction: t.recommendedAction,
      contact: contactStatus(t, p),
      reached,
      stage,
      contactSource: lastContact ? (lastRecord?.source === "app" ? "simulated" : "observed") : null,
      contactRecords: contacts.length,
      response,
      purchase,
      experimentOutcome,
      conversationStatus: conv?.status ?? null,
      events,
      lastActivity: activity[activity.length - 1] ?? null,
      sources: [...new Set(events.map((e) => e.source))],
    };
    return { ...base, next: nextStepFor(base) };
  });
}

/* --------------------------------------------------------------------- journeys */

/** Groups customers into derived journeys. A customer can be in several (e.g. an imported campaign and a REGAIN journey). */
export function buildJourneys(customers: CustomerJourney[], src: JourneySource): Journey[] {
  const byId = new Map<string, CustomerJourney[]>();
  for (const c of customers) for (const jid of c.journeyIds) byId.set(jid, [...(byId.get(jid) ?? []), c]);
  const latest = (cs: CustomerJourney[], jid: string) => {
    const ev = cs.flatMap((c) => c.events.filter((e) => e.journeyId === jid && e.type !== "decision" && e.type !== "signal"));
    return ev.sort(compareEvents(src.asOf)).at(-1) ?? null;
  };
  const out: Journey[] = [];
  for (const [jid, cs] of byId) {
    const srcs = [...new Set(cs.flatMap((c) => c.events.filter((e) => e.journeyId === jid).map((e) => e.source)))];
    if (jid.startsWith("regain:")) {
      const action = jid.slice(7) as ActionId;
      const active = cs.some((c) => c.decision !== "HOLD");
      // Only REGAIN's own (simulated) contacts count here; imported contacts belong to their campaign's journey.
      let purchased = 0, eligible = 0, windowOpen = 0, contacted = 0, responded = 0;
      for (const c of cs) {
        const sends = src.interventions.filter((r) => r.customerId === c.customerId && r.source === "app").map((r) => r.date).sort();
        if (!sends.length) continue;
        contacted++;
        if (c.response?.source === "simulated") responded++;
        const o = purchaseAfter(src, c.customerId, sends[sends.length - 1]);
        if (o.status === "window_open") windowOpen++;
        else {
          eligible++;
          if (o.status === "purchased") purchased++;
        }
      }
      out.push({ id: jid, name: `${ACTION_LABEL[action]} journey`, kind: "recovery", trigger: RECOVERY_TRIGGER[action] ?? "Suggested by REGAIN.", action: ACTION_LABEL[action], customers: cs.map((c) => c.customerId), status: active ? "Active" : "Monitoring", lastActivity: latest(cs, jid), contacted, responded, outcome: { purchased, eligible, windowOpen }, sources: srcs });
    } else if (jid === "hold:blocked") {
      out.push({ id: jid, name: "Can't be contacted", kind: "hold", trigger: "No consent, unsubscribed, said no, or messaged recently.", action: "No action", customers: cs.map((c) => c.customerId), status: "Blocked", lastActivity: latest(cs, jid), contacted: 0, responded: 0, outcome: null, sources: srcs });
    } else if (jid === "hold:none") {
      out.push({ id: jid, name: "No follow-up needed", kind: "hold", trigger: "Buying as usual, or a message isn't worth it.", action: "No action", customers: cs.map((c) => c.customerId), status: "No follow-up needed", lastActivity: latest(cs, jid), contacted: 0, responded: 0, outcome: null, sources: srcs });
    } else if (jid.startsWith("imported:")) {
      const campaign = jid.slice(9);
      const recs = src.interventions.filter((r) => r.source === "imported" && r.campaign === campaign);
      const treated = new Set(recs.filter((r) => r.group !== "control" && r.action !== "none").map((r) => r.customerId));
      const holdout = new Set(recs.filter((r) => r.group === "control" || r.action === "none").map((r) => r.customerId));
      const tc = cs.filter((c) => treated.has(c.customerId));
      // Outcome relative to this campaign's own contact date (not the customer's latest contact).
      let purchased = 0, eligible = 0, windowOpen = 0;
      for (const c of tc) {
        const r = recs.find((x) => x.customerId === c.customerId && treated.has(x.customerId)) as InterventionRecord;
        const o = purchaseAfter(src, c.customerId, r.date);
        if (o.status === "window_open") windowOpen++;
        else {
          eligible++;
          if (o.status === "purchased") purchased++;
        }
      }
      const actions = [...new Set(recs.filter((r) => treated.has(r.customerId)).map((r) => ACTION_LABEL[r.action as ActionId] ?? r.action))];
      out.push({ id: jid, name: campaign, kind: "imported", trigger: "From your imported contact records.", action: actions.join(", ") || "None", customers: cs.map((c) => c.customerId), status: windowOpen ? "In progress (imported)" : "Finished (imported)", lastActivity: latest(cs, jid), contacted: tc.length, responded: tc.filter((c) => c.response?.source === "observed").length, outcome: { purchased, eligible, windowOpen }, holdout: holdout.size, sources: srcs });
    } else if (jid.startsWith("exp:")) {
      const e = src.experiments.find((x) => `exp:${x.id}` === jid);
      if (!e) continue;
      let observed = 0, simulated = 0, purchased = 0;
      for (const m of e.members) {
        const o = e.outcomes[m.customerId];
        if (!o || o.purchased === null) continue;
        if (o.source === "simulated") simulated++;
        else observed++;
        if (o.purchased) purchased++;
      }
      const pending = e.members.length - observed - simulated;
      out.push({ id: jid, name: `${e.id} · ${e.name}`, kind: "experiment", trigger: "A test set up in Impact & Experiments.", action: "Test", customers: cs.map((c) => c.customerId), status: pending ? "Waiting for results" : "Results in", lastActivity: latest(cs, jid), contacted: 0, responded: 0, outcome: null, experiment: { observed, simulated, purchased, pending }, sources: srcs });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------- filters */

export type DateRange = "all" | "30" | "90" | "365";
export interface JourneyFilters {
  q: string;
  range: DateRange;
  status: "all" | JourneyStatus;
  action: "all" | ActionId;
  eventType: "all" | EventType;
  outcome: "all" | PurchaseStatus;
  mode: "all" | "observed" | "simulated";
  stage: "all" | StageKey;
  /** A single journey, e.g. from its Inspect button. */
  journey: "all" | string;
}
export const NO_FILTERS: JourneyFilters = { q: "", range: "all", status: "all", action: "all", eventType: "all", outcome: "all", mode: "all", stage: "all", journey: "all" };

/** Customers matching every filter. Journey-level filters (search by name, status) match any of the customer's journeys. */
export function filterCustomers(customers: CustomerJourney[], journeys: Journey[], f: JourneyFilters, asOf: string): CustomerJourney[] {
  const jById = new Map(journeys.map((j) => [j.id, j]));
  const q = f.q.trim().toLowerCase();
  const from = f.range === "all" ? null : addDays(asOf, -Number(f.range));
  return customers.filter((c) => {
    const js = c.journeyIds.map((id) => jById.get(id)).filter((x): x is Journey => !!x);
    if (q && !c.customerId.toLowerCase().includes(q) && !js.some((j) => j.name.toLowerCase().includes(q))) return false;
    if (f.status !== "all" && !js.some((j) => j.status === f.status)) return false;
    if (f.action !== "all" && c.recommendedAction !== f.action && !c.journeyIds.includes(`regain:${f.action}`)) return false;
    if (f.eventType !== "all" && !c.events.some((e) => e.type === f.eventType)) return false;
    if (f.outcome !== "all" && c.purchase.status !== f.outcome) return false;
    if (f.stage !== "all" && !c.reached[f.stage]) return false;
    if (f.journey !== "all" && !c.journeyIds.includes(f.journey)) return false;
    const journeyEvents = c.events.filter((e) => e.type !== "decision" && e.type !== "signal" && e.type !== "purchase");
    if (f.mode === "simulated" && !journeyEvents.some((e) => e.source === "simulated")) return false;
    if (f.mode === "observed" && !journeyEvents.some((e) => e.source === "observed" || e.source === "recorded")) return false;
    if (from) {
      // Undated app actions happened on the analysis date.
      if (!journeyEvents.some((e) => (e.date ?? asOf) >= from)) return false;
    }
    return true;
  });
}

/* ---------------------------------------------------------------------- metrics */

export interface FunnelStage {
  key: StageKey;
  label: string;
  help: string;
  /** Unique customers who reached the stage. */
  customers: number;
  /** Share of the previous stage — only when every customer here is also in the previous stage. */
  shareOfPrevious: number | null;
  /** Why no share is shown, when the previous stage is not a superset. */
  note?: string;
}

export function journeyFunnel(cs: CustomerJourney[]): FunnelStage[] {
  return STAGES.map((s, i) => {
    const here = cs.filter((c) => c.reached[s.key]);
    if (i === 0) return { ...s, customers: here.length, shareOfPrevious: null };
    const prev = STAGES[i - 1].key;
    const prevN = cs.filter((c) => c.reached[prev]).length;
    const subset = here.every((c) => c.reached[prev]);
    return {
      ...s,
      customers: here.length,
      shareOfPrevious: subset && prevN ? here.length / prevN : null,
      note: subset ? undefined : `No % shown: ${here.filter((c) => !c.reached[prev]).length} of these skipped the step before (for example, contacts from imported records).`,
    };
  });
}

export interface JourneyKpis {
  inView: number;
  contacted: { customers: number; simulated: number; observed: number; records: number };
  responded: { customers: number; ofContacted: number; simulated: number; observed: number };
  purchased: { customers: number; eligible: number; windowOpen: number; rate: number | null };
  needsReview: number;
  blocked: number;
}

export function journeyKpis(cs: CustomerJourney[]): JourneyKpis {
  const contacted = cs.filter((c) => c.reached.contacted);
  const responded = cs.filter((c) => c.reached.responded);
  const eligible = contacted.filter((c) => c.purchase.status === "purchased" || c.purchase.status === "no_purchase");
  const purchased = eligible.filter((c) => c.purchase.status === "purchased");
  return {
    inView: cs.length,
    contacted: { customers: contacted.length, simulated: contacted.filter((c) => c.contactSource === "simulated").length, observed: contacted.filter((c) => c.contactSource === "observed").length, records: contacted.reduce((s, c) => s + c.contactRecords, 0) },
    responded: { customers: responded.length, ofContacted: contacted.length, simulated: responded.filter((c) => c.response?.source === "simulated").length, observed: responded.filter((c) => c.response?.source === "observed").length },
    purchased: { customers: purchased.length, eligible: eligible.length, windowOpen: contacted.filter((c) => c.purchase.status === "window_open").length, rate: eligible.length ? purchased.length / eligible.length : null },
    needsReview: cs.filter((c) => c.next.kind === "review").length,
    blocked: cs.filter((c) => !c.contact.allowed).length,
  };
}

export interface OutcomeAnalysis {
  eligible: number;
  purchased: number;
  rate: number | null;
  windowOpen: number;
  /** Median days from contact to the first purchase in the window (purchasers only). */
  medianDaysToPurchase: number | null;
  /** Mean value of that first qualifying purchase. */
  avgQualifyingOrder: number | null;
  optOut: { customers: number; ofContacted: number; rate: number | null };
  simulatedNotInterested: number;
  bySource: { observed: { eligible: number; purchased: number; windowOpen: number }; simulated: { eligible: number; purchased: number; windowOpen: number } };
}

export function outcomeAnalysis(cs: CustomerJourney[]): OutcomeAnalysis {
  const contacted = cs.filter((c) => c.reached.contacted);
  const closed = contacted.filter((c) => c.purchase.status === "purchased" || c.purchase.status === "no_purchase");
  const bought = closed.filter((c) => c.purchase.status === "purchased");
  const days = bought.map((c) => c.purchase.daysToPurchase as number).sort((a, b) => a - b);
  const median = days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : null;
  const vals = bought.map((c) => c.purchase.purchaseValue as number);
  const by = (s: "observed" | "simulated") => {
    const g = contacted.filter((c) => c.contactSource === s);
    const e = g.filter((c) => c.purchase.status !== "window_open");
    return { eligible: e.length, purchased: e.filter((c) => c.purchase.status === "purchased").length, windowOpen: g.length - e.length };
  };
  const importedContacted = contacted.filter((c) => c.events.some((e) => e.type === "contact" && e.source === "observed"));
  const optOuts = importedContacted.filter((c) => c.response?.source === "observed" && c.response.negative);
  return {
    eligible: closed.length,
    purchased: bought.length,
    rate: closed.length ? bought.length / closed.length : null,
    windowOpen: contacted.length - closed.length,
    medianDaysToPurchase: median,
    avgQualifyingOrder: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    optOut: { customers: optOuts.length, ofContacted: importedContacted.length, rate: importedContacted.length ? optOuts.length / importedContacted.length : null },
    simulatedNotInterested: cs.filter((c) => c.response?.source === "simulated" && c.response.negative).length,
    bySource: { observed: by("observed"), simulated: by("simulated") },
  };
}

/* ---------------------------------------------------------------------- sorting */

export type CustomerSort = "attention" | "progress" | "activity" | "id";
/** "attention": a person's review first, then customers waiting on a window or reply, then the rest. */
const NEXT_RANK: Record<NextStep["kind"], number> = { review: 0, wait: 1, measure: 2, stop: 3, none: 4 };
const STAGE_RANK = Object.fromEntries(STAGES.map((s, i) => [s.key, i + 1])) as Record<StageKey, number>;
const activityKey = (c: CustomerJourney, asOf: string) => (c.lastActivity ? `${c.lastActivity.date ?? asOf}|${c.lastActivity.date === null ? 1 : 0}|${c.lastActivity.at ?? ""}` : "");

export function sortCustomers(cs: CustomerJourney[], by: CustomerSort, asOf: string): CustomerJourney[] {
  return [...cs].sort((a, b) => {
    if (by === "id") return a.customerId.localeCompare(b.customerId);
    if (by === "attention" && NEXT_RANK[a.next.kind] !== NEXT_RANK[b.next.kind]) return NEXT_RANK[a.next.kind] - NEXT_RANK[b.next.kind];
    if (by === "activity") {
      const ka = activityKey(a, asOf), kb = activityKey(b, asOf);
      return ka !== kb ? (ka < kb ? 1 : -1) : a.customerId.localeCompare(b.customerId);
    }
    const sa = a.stage ? STAGE_RANK[a.stage] : 0, sb = b.stage ? STAGE_RANK[b.stage] : 0;
    if (sa !== sb) return sb - sa;
    const ka = activityKey(a, asOf), kb = activityKey(b, asOf);
    return ka !== kb ? (ka < kb ? 1 : -1) : a.customerId.localeCompare(b.customerId);
  });
}

export type JourneySort = "customers" | "activity" | "name";
export function sortJourneys(js: Journey[], by: JourneySort, asOf: string): Journey[] {
  const kind: Record<JourneyKind, number> = { recovery: 0, imported: 1, experiment: 2, hold: 3 };
  const act = (j: Journey) => (j.lastActivity ? `${j.lastActivity.date ?? asOf}|${j.lastActivity.date === null ? 1 : 0}|${j.lastActivity.at ?? ""}` : "");
  return [...js].sort((a, b) => {
    if (by === "name") return a.name.localeCompare(b.name);
    if (by === "activity") return act(a) !== act(b) ? (act(a) < act(b) ? 1 : -1) : a.name.localeCompare(b.name);
    return kind[a.kind] - kind[b.kind] || b.customers.length - a.customers.length || a.name.localeCompare(b.name);
  });
}
