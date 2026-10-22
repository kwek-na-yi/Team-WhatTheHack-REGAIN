import { describe, expect, it } from "vitest";
import { analyse } from "@/lib/analysis";
import { buildProfiles } from "@/lib/behaviour";
import { initConversation, type ConversationState } from "@/lib/conversation";
import { simulateOutcomes, type Experiment } from "@/lib/experiment";
import { averageOrderValue, contactStatus, conversationJourney, latestContribution, priorityIds, purchaseTrend, repeatPurchaseRate, whatThisMeans } from "@/lib/insights";
import { appReducer, emptyState, sampleState, type AppState } from "@/lib/store";
import type { Transaction } from "@/lib/types";
import { addDays } from "@/lib/utils";
import { AS_OF, regular, txFor } from "./helpers";

const AT = "2026-10-21T00:00:00Z";
const SAMPLE = sampleState(AT);
const A = analyse(SAMPLE);
const profiles = (tx: Transaction[]) => buildProfiles(tx, { asOf: AS_OF });
const stateWith = (tx: Transaction[], extra: Partial<AppState> = {}): AppState => ({ ...emptyState(), transactions: tx, asOf: AS_OF, ...extra });

describe("purchase trend", () => {
  it("groups order lines into one order and sums their value", () => {
    const tx: Transaction[] = [
      { customerId: "A", orderId: "O1", date: addDays(AS_OF, -3), value: 10, category: "Beans", marketingConsent: "yes", optedOut: "no" },
      { customerId: "A", orderId: "O1", date: addDays(AS_OF, -3), value: 15, category: "Tea", marketingConsent: "yes", optedOut: "no" },
    ];
    const t = purchaseTrend(profiles(tx), AS_OF, "3m");
    expect(t.orders).toBe(1);
    expect(t.revenue).toBe(25);
    expect(averageOrderValue(t)).toBe(25);
  });

  it("uses complete 7-day periods ending on the analysis date for 3 and 6 months", () => {
    const t = purchaseTrend(profiles(txFor("A", [0, 6, 7, 30])), AS_OF, "3m");
    expect(t.grain).toBe("week");
    expect(t.points).toHaveLength(13);
    expect(t.points.at(-1)).toMatchObject({ end: AS_OF, start: addDays(AS_OF, -6), orders: 2, partial: false });
    expect(t.points.at(-2)!.orders).toBe(1);
    expect(t.points.every((p) => !p.partial)).toBe(true);
    expect(purchaseTrend(profiles(txFor("A", [0])), AS_OF, "6m").points).toHaveLength(26);
  });

  it("keeps empty months as zero, flags the current partial month and ignores future orders", () => {
    const tx = [...txFor("A", [400, 10]), ...txFor("B", [-5])]; // B's order is after the analysis date
    const t = purchaseTrend(profiles(tx), AS_OF, "12m");
    expect(t.grain).toBe("month");
    expect(t.points).toHaveLength(12);
    expect(t.points.filter((p) => p.orders === 0)).toHaveLength(11);
    expect(t.orders).toBe(1); // 400 days ago is outside 12 months; the future order is excluded
    expect(t.points.at(-1)!.partial).toBe(false); // 2026-09-30 is the last day of September
    const mid = purchaseTrend(profiles(txFor("A", [1])), "2026-09-15", "12m");
    expect(mid.points.at(-1)).toMatchObject({ start: "2026-09-01", end: "2026-09-15", partial: true });
    const all = purchaseTrend(profiles(tx), AS_OF, "all");
    expect(all.points[0].start).toBe(`${addDays(AS_OF, -400).slice(0, 7)}-01`);
    expect(all.orders).toBe(2);
  });

  it("handles an empty dataset", () => {
    expect(purchaseTrend([], AS_OF, "all")).toMatchObject({ points: [], orders: 0 });
    const t = purchaseTrend([], AS_OF, "12m");
    expect(t.orders).toBe(0);
    expect(averageOrderValue(t)).toBeNull();
  });

  it("matches the Command Centre's monthly order counts on the demo data", async () => {
    const { monthlyRevenue } = await import("@/lib/behaviour");
    const months = monthlyRevenue(SAMPLE.transactions, SAMPLE.asOf, 12);
    const t = purchaseTrend(A.profiles, SAMPLE.asOf, "12m");
    expect(t.points.map((p) => p.orders)).toEqual(months.map((m) => m.orders));
  });
});

describe("repeat-purchase rate", () => {
  it("counts only customers who had the whole window, and a later-day order within it", () => {
    const tx = [
      ...txFor("REPEAT", [200, 150]), // second order 50 days after the first → repeat
      ...txFor("LATE", [300, 150]), // second order 150 days after the first → not within 90
      ...txFor("ONCE", [120]), // eligible, never returned
      ...txFor("NEW", [30, 10]), // first purchase 30 days ago → window still open, excluded
    ];
    const sameDay: Transaction[] = [100, 100].map((d, i) => ({ customerId: "SAMEDAY", orderId: `S${i}`, date: addDays(AS_OF, -d), value: 20, category: "Beans", marketingConsent: "yes", optedOut: "no" }));
    const r = repeatPurchaseRate(profiles([...tx, ...sameDay]), AS_OF);
    expect(r).toMatchObject({ windowDays: 90, eligible: 4, repeated: 1, stillOpen: 1 });
    expect(r.rate).toBeCloseTo(0.25);
  });

  it("includes the boundary day and reports unavailable when nobody is eligible", () => {
    expect(repeatPurchaseRate(profiles(txFor("A", [180, 90])), AS_OF).repeated).toBe(1);
    const none = repeatPurchaseRate(profiles(txFor("A", [20])), AS_OF);
    expect(none).toMatchObject({ eligible: 0, rate: null, stillOpen: 1 });
    expect(repeatPurchaseRate([], AS_OF).rate).toBeNull();
  });
});

describe("decisions, priority table and contact eligibility", () => {
  it("breakdown counts equal the engine's decisions", () => {
    const n = (d: string) => Object.values(A.trials).filter((t) => t.decision === d).length;
    expect(A.counts).toEqual({ RECOVER: n("RECOVER"), UNDERSTAND: n("UNDERSTAND"), HOLD: n("HOLD") });
    expect(priorityIds(A, "attention")).toHaveLength(A.counts.RECOVER + A.counts.UNDERSTAND);
    expect(priorityIds(A, "all")).toHaveLength(A.profiles.length);
  });

  it("filters by decision and search text", () => {
    for (const d of ["RECOVER", "UNDERSTAND", "HOLD"] as const) {
      const ids = priorityIds(A, d);
      expect(ids).toHaveLength(A.counts[d]);
      expect(ids.every((id) => A.trials[id].decision === d)).toBe(true);
    }
    expect(priorityIds(A, "all", "c0053")).toEqual(["C0053"]);
    expect(priorityIds(A, "all", "ZZZ")).toEqual([]);
  });

  it("ranks by decision then estimated value, never by past spend", () => {
    const ids = priorityIds(A, "all");
    const firstHold = ids.findIndex((id) => A.trials[id].decision === "HOLD");
    expect(ids.slice(firstHold).every((id) => A.trials[id].decision === "HOLD")).toBe(true);
    const scores = ids.slice(0, firstHold).map((id) => A.trials[id].priorityScore);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
    // The highest historical spender is not automatically first: ranking by spend gives a different list.
    const bySpend = [...ids.slice(0, firstHold)].sort((x, y) => A.byId[y].totalSpend - A.byId[x].totalSpend);
    expect(bySpend).not.toEqual(ids.slice(0, firstHold));
  });

  it("never shows an opted-out, unconsented or capped customer as eligible", () => {
    for (const id of priorityIds(A, "all")) {
      const t = A.trials[id];
      const c = contactStatus(t, A.byId[id]);
      expect(c.allowed).toBe(!t.suppression);
      if (t.suppression) expect(t.decision).toBe("HOLD");
    }
    const s = stateWith([...regular("OPT", 25, 45, 10, { optedOut: "yes" }), ...regular("NOC", 25, 45, 10, { marketingConsent: "unknown" }), ...regular("NO", 25, 45, 10, { marketingConsent: "no" })]);
    const a = analyse(s);
    expect(contactStatus(a.trials.OPT, a.byId.OPT)).toEqual({ allowed: false, label: "Opted out" });
    expect(contactStatus(a.trials.NOC, a.byId.NOC)).toEqual({ allowed: false, label: "Consent not recorded" });
    expect(contactStatus(a.trials.NO, a.byId.NO)).toEqual({ allowed: false, label: "No consent" });
    const capped = analyse({ ...s, transactions: regular("CAP", 25, 45, 10), interventions: [{ customerId: "CAP", date: addDays(AS_OF, -3), action: "reminder", group: "treatment", purchased: "unknown", optedOut: "no", campaign: "x", source: "app" }] });
    expect(contactStatus(capped.trials.CAP, capped.byId.CAP)).toEqual({ allowed: false, label: "Contact limit reached" });
  });
});

describe("conversation journey", () => {
  const conv = (id: string, over: Partial<ConversationState> = {}): ConversationState => ({ ...initConversation(id, "reminder", "Hi {first_name}"), ...over });

  it("counts only records that exist; percentages only for subset stages", () => {
    const j = conversationJourney(A, {
      C0053: conv("C0053", { sends: 1, status: "awaiting_response" }),
      C0107: conv("C0107", { sends: 1, status: "positive", lastResponse: "interested" }),
      C0138: conv("C0138"),
      GONE: conv("GONE", { sends: 1 }), // not in the dataset — ignored
    }, []);
    const s = Object.fromEntries(j.stages.map((x) => [x.key, x]));
    expect(s.attention.count).toBe(A.counts.RECOVER + A.counts.UNDERSTAND);
    expect(s.attention.shareOfPrevious).toBeNull();
    expect(s.drafted).toMatchObject({ count: 3, shareOfPrevious: null });
    expect(s.approved.count).toBe(2);
    expect(s.approved.shareOfPrevious).toBeCloseTo(2 / 3);
    expect(s.replied.count).toBe(1);
    expect(s.replied.shareOfPrevious).toBeCloseTo(0.5);
    expect(j.replies).toEqual({ interested: 1 });
  });

  it("labels sends and replies as simulated and keeps measured outcomes separate", () => {
    const j = conversationJourney(A, {}, []);
    expect(j.stages.find((x) => x.key === "approved")!.simulated).toBe(true);
    expect(j.stages.find((x) => x.key === "replied")!.simulated).toBe(true);
    expect(j.stages.find((x) => x.key === "approved")!.shareOfPrevious).toBeNull(); // 0 drafts → no percentage
    expect(j.outcomes).toEqual({ observed: { recorded: 0, purchased: 0 }, simulated: { recorded: 0, purchased: 0 }, pending: 0, experiments: 0 });
  });

  it("never counts pending outcomes, and separates simulated from observed", () => {
    const members = ["a", "b", "c", "d"].map((customerId, i) => ({ customerId, group: (i % 2 ? "control" : "treatment") as "control" | "treatment", action: "reminder" as const, assumedProb: 0.5, typicalOrderValue: 40, contactCost: 0.5, discountRate: 0, benefitCost: 0 }));
    const exp: Experiment = { id: "EXP-1", name: "t", startDate: AS_OF, windowDays: 30, seed: "s", holdoutShare: 0.5, marginRate: 0.4, members, createdAt: AT, outcomes: { a: { purchased: true, revenue: 40, optedOut: false, negative: false, source: "manual" }, b: { purchased: null, revenue: 0, optedOut: false, negative: false, source: "manual" } } };
    const sim = { ...exp, id: "EXP-2", outcomes: simulateOutcomes(exp) };
    const j = conversationJourney(A, {}, [exp, sim]);
    expect(j.outcomes.observed).toEqual({ recorded: 1, purchased: 1 });
    expect(j.outcomes.pending).toBe(3); // b (pending) + c, d (no outcome)
    expect(j.outcomes.simulated.recorded).toBe(4);
  });
});

describe("incremental contribution source", () => {
  it("uses the imported campaign comparison on the demo, without inventing a contribution", () => {
    const c = latestContribution([], SAMPLE.interventions);
    expect(c.kind).toBe("imported");
    expect(c).not.toHaveProperty("value");
  });
  it("reports nothing when there is no comparison group", () => {
    expect(latestContribution([], [])).toEqual({ kind: "none" });
  });
});

describe("what this means", () => {
  it("states the usual and current gap from the customer's own data", () => {
    const p = A.byId.C0053;
    const lines = whatThisMeans(p, A.trials.C0053);
    expect(lines[0]).toContain(`usually purchases every ${Math.round(p.medianInterval!)} days`);
    expect(lines[1]).toContain(`${p.recencyDays} days ago`);
    expect(lines[1]).toMatch(/longer than usual/);
    expect(lines).toContain("No service interaction is recorded.");
    expect(lines).toContain("The data shows a change in buying behaviour, but it cannot establish why the customer has not returned.");
    expect(lines.join(" ")).not.toMatch(/\b(unhappy|dissatisfied|angry)\b/);
  });

  it("is honest about one-purchase customers and on-rhythm buyers", () => {
    const a = analyse(stateWith([...txFor("ONE", [40]), ...regular("OK", 30, 10, 8)]));
    expect(whatThisMeans(a.byId.ONE, a.trials.ONE).join(" ")).toMatch(/bought only once.*isn't enough history/);
    const ok = whatThisMeans(a.byId.OK, a.trials.OK);
    expect(ok).toContain("Nothing in the purchase data suggests a change in buying behaviour.");
  });

  it("reports a recorded complaint and blocked contact accurately", () => {
    const tx = regular("X", 25, 60, 10, { optedOut: "yes" });
    tx[tx.length - 1] = { ...tx[tx.length - 1], serviceIssue: "Late delivery", serviceIssueResolved: "no" };
    const a = analyse(stateWith(tx));
    const text = whatThisMeans(a.byId.X, a.trials.X).join(" ");
    expect(text).toContain("“Late delivery”");
    expect(text).toMatch(/doesn't show whether it caused/);
    expect(text).toMatch(/not allowed \(opted out\)/);
  });
});

describe("import and reset", () => {
  it("overview metrics follow an uploaded CSV, then reset with the demo", () => {
    const tx = [...txFor("U1", [200, 150]), ...txFor("U2", [100])];
    const uploaded = appReducer(SAMPLE, { type: "IMPORT_TRANSACTIONS", records: tx, asOf: AS_OF, at: AT, summary: { fileName: "u.csv", totalRows: 3, acceptedRows: 3, rejectedRows: 0, duplicateRows: 0, excludedColumns: [], optionalMissing: [] } });
    const ua = analyse(uploaded);
    expect(ua.profiles.map((p) => p.customerId).sort()).toEqual(["U1", "U2"]);
    expect(repeatPurchaseRate(ua.profiles, uploaded.asOf)).toMatchObject({ eligible: 2, repeated: 1 });
    expect(conversationJourney(ua, uploaded.conversations, uploaded.experiments).stages[1].count).toBe(0);
    const reset = appReducer({ ...uploaded, conversations: { U1: conv1() } }, { type: "LOAD_SAMPLE", at: AT });
    const ra = analyse(reset);
    expect(ra.profiles).toHaveLength(A.profiles.length);
    expect(conversationJourney(ra, reset.conversations, reset.experiments).stages[1].count).toBe(0);
    const cleared = analyse(appReducer(reset, { type: "CLEAR_ALL", at: AT }));
    expect(priorityIds(cleared, "all")).toEqual([]);
  });
});

function conv1(): ConversationState {
  return initConversation("U1", "reminder", "Hi");
}
