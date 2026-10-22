import { describe, expect, it } from "vitest";
import { analyse } from "@/lib/analysis";
import { conversationReducer, initConversation, type ConversationState } from "@/lib/conversation";
import { simulateOutcomes, type Experiment } from "@/lib/experiment";
import {
  buildCustomerJourneys,
  buildJourneys,
  compareEvents,
  filterCustomers,
  journeyFunnel,
  journeyIdFor,
  journeyKpis,
  NO_FILTERS,
  OUTCOME_WINDOW_DAYS,
  outcomeAnalysis,
  sortCustomers,
  sortJourneys,
  type JourneySource,
} from "@/lib/journey";
import { appReducer, emptyState, sampleState, type AppState } from "@/lib/store";
import type { InterventionRecord, Transaction } from "@/lib/types";
import { addDays } from "@/lib/utils";
import { AS_OF, regular, txFor } from "./helpers";

const AT = "2026-10-21T09:00:00.000Z";
const SAMPLE = sampleState(AT);
const srcOf = (s: AppState): JourneySource => ({ analysis: analyse(s), interventions: s.interventions, conversations: s.conversations, experiments: s.experiments, audit: s.audit, asOf: s.asOf });
const model = (s: AppState) => {
  const src = srcOf(s);
  const customers = buildCustomerJourneys(src);
  return { src, customers, journeys: buildJourneys(customers, src), byId: Object.fromEntries(customers.map((c) => [c.customerId, c])) };
};
const ctx = { businessName: "Shop", tone: "warm" as const, channel: "email" as const, decision: "RECOVER" as const, topCategory: "Beans", lastOrderDate: AS_OF, recencyDays: 40, usualInterval: 25, discountRate: 0.15, benefitDescription: "a gift" };

/** Replays what Conversation Studio dispatches: draft → approve (simulated send) → optional simulated reply. */
function studio(s: AppState, id: string, opts: { approve?: boolean; reject?: string; reply?: "interested" | "not_interested" } = {}, t = 0): AppState {
  const at = (n: number) => new Date(Date.parse(AT) + (t + n) * 60_000).toISOString();
  let conv: ConversationState = initConversation(id, "reminder", "Hi {first_name}. Reply STOP to stop these messages.");
  s = appReducer(s, { type: "SAVE_CONVERSATION", conv });
  if (opts.reject) {
    conv = conversationReducer(conv, { type: "REJECT", reason: opts.reject });
    s = appReducer(s, { type: "SAVE_CONVERSATION", conv });
    s = appReducer(s, { type: "AUDIT", entry: { at: at(1), type: "message_rejected", customerId: id, detail: `Draft rejected: ${opts.reject}.` } });
  }
  if (opts.approve) {
    conv = conversationReducer(conv, { type: "APPROVE", reviewed: true, warnings: [] });
    s = appReducer(s, { type: "SAVE_CONVERSATION", conv });
    s = appReducer(s, { type: "RECORD_SEND", customerId: id, action: "reminder", at: at(2), detail: "Approved & simulated send of Replenishment reminder (template draft, email). Counts toward frequency cap." });
  }
  if (opts.reply) {
    conv = conversationReducer(conv, { type: "RESPOND", kind: opts.reply, ctx: { ...ctx, action: "reminder" } });
    s = appReducer(s, { type: "SAVE_CONVERSATION", conv });
    s = appReducer(s, { type: "AUDIT", entry: { at: at(3), type: "response_simulated", customerId: id, detail: `Simulated customer response: ${opts.reply}.` } });
    if (opts.reply === "not_interested") s = appReducer(s, { type: "SUPPRESS", customerId: id, days: 90, at: at(4) });
  }
  return s;
}

const base = (tx: Transaction[], iv: InterventionRecord[] = []): AppState => ({ ...emptyState(), transactions: tx, interventions: iv, asOf: AS_OF });
const imported = (customerId: string, daysAgo: number, over: Partial<InterventionRecord> = {}): InterventionRecord => ({ customerId, date: addDays(AS_OF, -daysAgo), action: "reminder", group: "treatment", purchased: "unknown", optedOut: "no", campaign: "Spring test", source: "imported", ...over });

describe("journey stages", () => {
  it("derives each stage only from its own record (drafted ≠ approved ≠ responded)", () => {
    let s = base([...regular("A", 25, 45, 10), ...regular("B", 25, 45, 10), ...regular("C", 25, 45, 10), ...regular("D", 25, 45, 10)]);
    s = studio(s, "A");
    s = studio(s, "B", { reject: "Tone" });
    s = studio(s, "C", { approve: true });
    s = studio(s, "D", { approve: true, reply: "interested" });
    const { byId } = model(s);
    expect(byId.A.reached).toMatchObject({ recommended: true, drafted: true, reviewed: false, approved: false, contacted: false, responded: false });
    expect(byId.A.stage).toBe("drafted");
    expect(byId.B.reached).toMatchObject({ drafted: true, reviewed: true, approved: false, contacted: false });
    expect(byId.C.reached).toMatchObject({ reviewed: true, approved: true, contacted: true, responded: false, purchased: false });
    expect(byId.C.contactSource).toBe("simulated");
    expect(byId.C.purchase.status).toBe("window_open"); // a simulated send is dated the analysis date
    expect(byId.D.reached.responded).toBe(true);
    expect(byId.D.response).toMatchObject({ source: "simulated" });
  });

  it("observed imported contacts reach 'contacted' without implying review or approval", () => {
    const tx = [...regular("I", 20, 15, 8)];
    const { byId } = model(base(tx, [imported("I", 50)]));
    expect(byId.I.reached).toMatchObject({ drafted: false, reviewed: false, approved: false, contacted: true });
    expect(byId.I.contactSource).toBe("observed");
  });

  it("comparison-group records are not contacts", () => {
    const { byId } = model(base(regular("H", 20, 15, 8), [imported("H", 50, { group: "control", action: "none" })]));
    expect(byId.H.reached.contacted).toBe(false);
    expect(byId.H.events.some((e) => e.type === "holdout")).toBe(true);
  });

  it("only shows a stage share when every customer there passed the previous stage", () => {
    let s = base([...regular("A", 25, 45, 10), ...regular("C", 25, 45, 10), ...regular("I", 20, 15, 8)], [imported("I", 50)]);
    s = studio(s, "A");
    s = studio(s, "C", { approve: true });
    const f = Object.fromEntries(journeyFunnel(model(s).customers).map((x) => [x.key, x]));
    expect(f.drafted.customers).toBe(2);
    expect(f.approved.customers).toBe(1);
    expect(f.approved.shareOfPrevious).toBeCloseTo(1); // approved ⊆ reviewed
    expect(f.contacted.customers).toBe(2); // C (simulated) + I (imported)
    expect(f.contacted.shareOfPrevious).toBeNull(); // I never passed through "approved"
    expect(f.contacted.note).toMatch(/skipped the step before/);
  });
});

describe("unique customers vs records", () => {
  it("counts a customer once however many contacts and events they have", () => {
    let s = base(regular("M", 20, 15, 8), [imported("M", 120), imported("M", 80, { campaign: "Summer test" })]);
    s = studio(s, "M", { approve: true, reply: "interested" });
    const { customers } = model(s);
    const k = journeyKpis(customers);
    expect(k.contacted.customers).toBe(1);
    expect(k.contacted.records).toBe(3);
    expect(k.responded.customers).toBe(1);
    expect(customers.filter((c) => c.customerId === "M")).toHaveLength(1);
    expect(new Set(customers[0].events.map((e) => e.id)).size).toBe(customers[0].events.length);
  });
});

describe("purchase after contact", () => {
  it("uses the window after the latest contact and excludes open windows from the rate", () => {
    const tx = [
      ...txFor("BUY", [200, 150, 60, 40]), // contact 50 days ago, order 40 days ago → bought
      ...txFor("NOBUY", [200, 150, 90]), // contact 50 days ago, nothing since → no purchase
      ...txFor("LATE", [200, 150, 5]), // contact 50 days ago, order 45 days later → outside window
      ...txFor("OPEN", [200, 150, 90]), // contact 10 days ago → window open
    ];
    const iv = [imported("BUY", 50), imported("NOBUY", 50), imported("LATE", 50), imported("OPEN", 10)];
    const { byId, customers } = model(base(tx, iv));
    expect(byId.BUY.purchase).toMatchObject({ status: "purchased", daysToPurchase: 10 });
    expect(byId.NOBUY.purchase.status).toBe("no_purchase");
    expect(byId.LATE.purchase.status).toBe("no_purchase");
    expect(byId.OPEN.purchase).toMatchObject({ status: "window_open", windowEnd: addDays(AS_OF, OUTCOME_WINDOW_DAYS - 10) });
    const o = outcomeAnalysis(customers);
    expect(o).toMatchObject({ eligible: 3, purchased: 1, windowOpen: 1, medianDaysToPurchase: 10 });
    expect(o.rate).toBeCloseTo(1 / 3);
    expect(journeyKpis(customers).purchased).toMatchObject({ customers: 1, eligible: 3, windowOpen: 1 });
  });

  it("handles customers with no contact or no outcome", () => {
    const { customers } = model(base(regular("Z", 30, 10, 6)));
    expect(customers[0].purchase.status).toBe("no_contact");
    expect(outcomeAnalysis(customers)).toMatchObject({ eligible: 0, rate: null, medianDaysToPurchase: null, avgQualifyingOrder: null });
  });

  it("matches the sample campaign's own purchased flags", () => {
    const { byId } = model(SAMPLE);
    const recs = SAMPLE.interventions.filter((r) => r.campaign === "May-26 replenishment reminder test" && r.group === "treatment");
    for (const r of recs) {
      const c = byId[r.customerId];
      if (c.purchase.contactDate !== r.date) continue; // a later contact moved the window
      expect(c.purchase.status === "purchased").toBe(r.purchased === "yes");
    }
  });
});

describe("timeline", () => {
  it("orders events chronologically, app actions after dated records, by recorded time", () => {
    let s = base(regular("T", 25, 45, 10), [imported("T", 120)]);
    s = studio(s, "T", { approve: true, reply: "interested" });
    const ev = model(s).byId.T.events;
    const sorted = [...ev].sort(compareEvents(AS_OF));
    expect(ev.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
    const types = ev.map((e) => e.type);
    expect(types.indexOf("contact")).toBeLessThan(types.indexOf("decision")); // imported contact (120 days ago)
    expect(types.indexOf("drafted")).toBeLessThan(types.indexOf("approved"));
    // The simulated send is recorded at the same moment as its approval and must follow it.
    const send = ev.findIndex((e) => e.type === "contact" && e.source === "simulated");
    expect(types.indexOf("approved")).toBeLessThan(send);
    expect(send).toBeLessThan(types.indexOf("response"));
  });

  it("never invents a timestamp: drafts have neither a date nor a time", () => {
    const ev = model(studio(base(regular("T", 25, 45, 10)), "T")).byId.T.events;
    const d = ev.find((e) => e.type === "drafted")!;
    expect(d.date).toBeNull();
    expect(d.at).toBeNull();
    const send = model(studio(base(regular("T", 25, 45, 10)), "T", { approve: true })).byId.T.events.find((e) => e.type === "contact")!;
    expect(send).toMatchObject({ source: "simulated", date: null, at: "2026-10-21T09:02:00.000Z" });
  });

  it("labels sources: observed records, recorded actions, simulated sends and replies, calculated signals", () => {
    let s = base(regular("T", 25, 45, 10), [imported("T", 120)]);
    s = studio(s, "T", { approve: true, reply: "interested" });
    const by = (t: string) => model(s).byId.T.events.filter((e) => e.type === t).map((e) => e.source);
    expect(by("purchase").every((x) => x === "observed")).toBe(true);
    expect(by("contact")).toEqual(["observed", "simulated"]);
    expect(by("approved")).toEqual(["recorded"]);
    expect(by("response")).toEqual(["simulated"]);
    expect(by("decision")).toEqual(["calculated"]);
    expect(by("signal")).toEqual(["calculated"]);
  });

  it("separates simulated and observed experiment outcomes, and never counts pending", () => {
    const s0 = base([...regular("E1", 25, 45, 10), ...regular("E2", 25, 45, 10)]);
    const members = ["E1", "E2"].map((customerId, i) => ({ customerId, group: (i ? "control" : "treatment") as "control" | "treatment", action: "reminder" as const, assumedProb: 0.4, typicalOrderValue: 40, contactCost: 0.5, discountRate: 0, benefitCost: 0 }));
    const e: Experiment = { id: "EXP-01", name: "Test", startDate: AS_OF, windowDays: 30, seed: "x", holdoutShare: 0.5, marginRate: 0.4, members, outcomes: {}, createdAt: AT };
    const sim = { ...e, outcomes: { E1: simulateOutcomes(e).E1 } };
    const m = model({ ...s0, experiments: [sim] });
    expect(m.byId.E1.events.find((x) => x.type === "outcome")?.source).toBe("simulated");
    expect(m.byId.E2.events.some((x) => x.type === "outcome")).toBe(false);
    const j = m.journeys.find((x) => x.id === "exp:EXP-01")!;
    expect(j.experiment).toMatchObject({ simulated: 1, observed: 0, pending: 1 });
    expect(j.status).toBe("Waiting for results");
  });
});

describe("contact safeguards", () => {
  it("never suggests contact for opted-out, unconsented or capped customers", () => {
    const tx = [...regular("OPT", 25, 45, 10, { optedOut: "yes" }), ...regular("NOC", 25, 45, 10, { marketingConsent: "unknown" }), ...regular("CAP", 25, 45, 10)];
    let s = base(tx, [{ customerId: "CAP", date: addDays(AS_OF, -3), action: "reminder", group: "treatment", purchased: "unknown", optedOut: "no", campaign: "x", source: "imported" }]);
    s = studio(s, "OPT"); // a draft exists, but the customer has opted out
    const { byId } = model(s);
    for (const id of ["OPT", "NOC", "CAP"]) {
      expect(byId[id].contact.allowed).toBe(false);
      expect(byId[id].next.kind).toBe("stop");
      expect(byId[id].next.text).not.toMatch(/draft a message|review the recommendation/i);
    }
    expect(byId.OPT.next.text).toMatch(/Don't send the message/);
    expect(byId.CAP.contact.label).toBe("Contact limit reached");
  });

  it("a 'not interested' reply pauses contact through the existing suppression rule", () => {
    const s = studio(base(regular("N", 25, 45, 10)), "N", { approve: true, reply: "not_interested" });
    const c = model(s).byId.N;
    expect(c.contact).toEqual({ allowed: false, label: "Declined — paused" });
    expect(c.response?.negative).toBe(true);
    expect(c.events.some((e) => e.type === "suppressed")).toBe(true);
  });

  it("building the view never changes state", () => {
    const s = studio(base(regular("A", 25, 45, 10)), "A", { approve: true });
    const before = JSON.stringify(s);
    model(s);
    filterCustomers(model(s).customers, model(s).journeys, { ...NO_FILTERS, q: "A" }, AS_OF);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("journeys, filters, sorting", () => {
  it("assigns every customer exactly one primary journey, deterministically", () => {
    const { customers, src } = model(SAMPLE);
    for (const c of customers) expect(journeyIdFor(c.customerId, src)).toBe(c.journeyId);
    const primaries = customers.map((c) => c.journeyId);
    expect(primaries).toHaveLength(SAMPLE_COUNT());
    const a = analyse(SAMPLE);
    expect(customers.filter((c) => c.journeyId === "hold:blocked").length).toBe(Object.values(a.trials).filter((t) => t.decision === "HOLD" && t.suppression).length);
  });

  it("derives the imported campaign journey with its holdout and observed outcome", () => {
    const { journeys } = model(SAMPLE);
    const may = journeys.find((j) => j.id === "imported:May-26 replenishment reminder test")!;
    const recs = SAMPLE.interventions.filter((r) => r.campaign === "May-26 replenishment reminder test");
    expect(may.contacted).toBe(recs.filter((r) => r.group === "treatment").length);
    expect(may.holdout).toBe(recs.filter((r) => r.group === "control").length);
    expect(may.outcome).toMatchObject({ eligible: may.contacted, purchased: recs.filter((r) => r.group === "treatment" && r.purchased === "yes").length });
    expect(may.status).toBe("Finished (imported)");
    const sept = journeys.find((j) => j.id === "imported:Sept-26 manual check-ins")!;
    expect(sept.status).toBe("In progress (imported)");
  });

  it("credits a REGAIN journey only with REGAIN's own contacts, not imported ones", () => {
    // R was contacted (and bought) in an imported campaign, and is now on REGAIN's reminder journey.
    const tx = [...txFor("R", [300, 275, 250, 225, 200, 175, 150, 125, 90, 45])];
    let s = base(tx, [imported("R", 100)]);
    const before = model(s);
    const regainBefore = before.journeys.find((j) => j.id === before.byId.R.journeyId)!;
    expect(regainBefore.kind).toBe("recovery");
    expect(regainBefore.contacted).toBe(0);
    expect(regainBefore.outcome).toEqual({ purchased: 0, eligible: 0, windowOpen: 0 });
    expect(before.journeys.find((j) => j.id === "imported:Spring test")!.outcome).toEqual({ purchased: 1, eligible: 1, windowOpen: 0 });
    s = studio(s, "R", { approve: true });
    const after = model(s).journeys.find((j) => j.kind === "recovery")!;
    expect(after.contacted).toBe(1);
    expect(after.outcome).toEqual({ purchased: 0, eligible: 0, windowOpen: 1 }); // the simulated send's window is still open
  });

  it("filters by search, journey, stage, outcome, event type, data mode and date", () => {
    let s = base([...regular("A1", 25, 45, 10), ...regular("B2", 25, 45, 10), ...regular("I3", 20, 15, 8)], [imported("I3", 200)]);
    s = studio(s, "A1", { approve: true });
    const { customers, journeys } = model(s);
    const ids = (f: Partial<typeof NO_FILTERS>) => filterCustomers(customers, journeys, { ...NO_FILTERS, ...f }, AS_OF).map((c) => c.customerId).sort();
    expect(ids({ q: "a1" })).toEqual(["A1"]); // case-insensitive ID search
    expect(ids({ q: "spring" })).toEqual(["I3"]); // matches the journey name
    expect(ids({ journey: "imported:Spring test" })).toEqual(["I3"]);
    expect(ids({ stage: "approved" })).toEqual(["A1"]);
    expect(ids({ outcome: "window_open" })).toEqual(["A1"]);
    expect(ids({ eventType: "drafted" })).toEqual(["A1"]);
    expect(ids({ mode: "simulated" })).toEqual(["A1"]);
    expect(ids({ mode: "observed" })).toEqual(["A1", "I3"]); // A1's approval was recorded by a person
    expect(ids({ range: "30" })).toEqual(["A1"]); // I3's only journey event is 200 days old; purchases don't count as journey activity
    expect(ids({ range: "365" })).toEqual(["A1", "I3"]);
    expect(ids({ status: "Finished (imported)" })).toEqual(["I3"]);
    expect(ids({ q: "nobody" })).toEqual([]);
  });

  it("sorts customers by stage then activity, and journeys by type then size", () => {
    let s = base([...regular("A", 25, 45, 10), ...regular("B", 25, 45, 10), ...regular("C", 25, 45, 10)]);
    s = studio(s, "B");
    s = studio(s, "C", { approve: true, reply: "interested" });
    const { customers, journeys } = model(s);
    expect(sortCustomers(customers, "progress", AS_OF).map((c) => c.customerId)).toEqual(["C", "B", "A"]);
    expect(sortCustomers(customers, "id", AS_OF).map((c) => c.customerId)).toEqual(["A", "B", "C"]);
    // Needs-review first. C's simulated send triggered the contact limit, so C is blocked ("stop") and goes last;
    // B (unapproved draft) and A (recommendation to review) need a person, furthest stage first.
    const att = sortCustomers(customers, "attention", AS_OF);
    expect(att.map((c) => [c.customerId, c.next.kind])).toEqual([["B", "review"], ["A", "review"], ["C", "stop"]]);
    expect(sortJourneys(journeys, "name", AS_OF).map((j) => j.name)).toEqual([...journeys.map((j) => j.name)].sort());
  });

  it("is empty but valid with no data, and resets with the demo", () => {
    const empty = model(emptyState());
    expect(empty.customers).toEqual([]);
    expect(empty.journeys).toEqual([]);
    expect(journeyKpis(empty.customers)).toMatchObject({ inView: 0, needsReview: 0, blocked: 0 });
    expect(journeyFunnel(empty.customers).every((s) => s.customers === 0 && s.shareOfPrevious === null)).toBe(true);
    let s = studio(SAMPLE, "C0053", { approve: true });
    expect(model(s).byId.C0053.reached.approved).toBe(true);
    s = appReducer(s, { type: "LOAD_SAMPLE", at: AT });
    expect(model(s).byId.C0053.reached.approved).toBe(false);
    const up = appReducer(s, { type: "IMPORT_TRANSACTIONS", records: regular("U1", 30, 10, 6), asOf: AS_OF, at: AT, summary: { fileName: "u.csv", totalRows: 6, acceptedRows: 6, rejectedRows: 0, duplicateRows: 0, excludedColumns: [], optionalMissing: [] } });
    const m = model(up);
    expect(m.customers.map((c) => c.customerId)).toEqual(["U1"]);
    expect(m.journeys.map((j) => j.id)).toEqual(["hold:none"]);
  });
});

function SAMPLE_COUNT() {
  return analyse(SAMPLE).profiles.length;
}
