import { describe, expect, it } from "vitest";
import { checkContactPolicy } from "@/lib/policy";
import { DEFAULT_ASSUMPTIONS, runTrial, scenarioEconomics } from "@/lib/trial";
import type { Assumptions, InterventionRecord } from "@/lib/types";
import { addDays } from "@/lib/utils";
import { AS_OF, profileOf, regular, txFor } from "./helpers";

const A: Assumptions = structuredClone(DEFAULT_ASSUMPTIONS);
const ctx = (over: Partial<Parameters<typeof runTrial>[1]> = {}) => ({ assumptions: A, interventions: [] as InterventionRecord[], asOf: AS_OF, ...over });

describe("scenario economics arithmetic", () => {
  const base = { p0: 0.2, uplift: 0.1, N: 2, aov: 50, margin: 0.4, contactCost: 1, benefitCost: 0, discountRate: 0, optOutRiskPp: 0.01, optOutLoss: 20 };
  it("computes revenue, contribution, costs and incremental contribution consistently", () => {
    const r = scenarioEconomics({ ...base, action: "reminder" });
    expect(r.actionProb).toBeCloseTo(0.3);
    expect(r.expectedOrders).toBeCloseTo(0.6);
    expect(r.expectedRevenue).toBeCloseTo(30);
    expect(r.grossContribution).toBeCloseTo(12);
    expect(r.totalCost).toBeCloseTo(1 + 0.2);
    expect(r.netContribution).toBeCloseTo(10.8);
    // baseline net = 0.2 × 2 × 50 × 0.4 = 8
    expect(r.incrementalContribution).toBeCloseTo(2.8);
    // closed form: u × N × AOV × m − costs
    expect(r.incrementalContribution).toBeCloseTo(0.1 * 2 * 50 * 0.4 - 1.2);
    expect(r.incrementalRevenue).toBeCloseTo(10);
  });
  it("charges the discount to baseline buyers too (leakage)", () => {
    const r = scenarioEconomics({ ...base, action: "discount", discountRate: 0.2 });
    expect(r.discountCost).toBeCloseTo(0.3 * 0.2 * 50);
    expect(r.discountLeakage).toBeCloseTo(0.2 * 0.2 * 50);
    expect(r.incrementalContribution).toBeCloseTo(4 - 1 - 3 - 0.2);
  });
  it("no action has zero cost and zero increment", () => {
    const r = scenarioEconomics({ ...base, action: "no_action" });
    expect(r.totalCost).toBe(0);
    expect(r.incrementalContribution).toBeCloseTo(0);
    expect(r.actionProb).toBe(0.2);
  });
  it("caps the action probability at 95%", () => {
    expect(scenarioEconomics({ ...base, p0: 0.9, uplift: 0.3, action: "check_in" }).actionProb).toBe(0.95);
  });
});

describe("decision ranking", () => {
  it("recommends a reminder for a regular buyer who is overdue", () => {
    const p = profileOf(regular("A", 25, 45, 10), "A");
    const t = runTrial(p, ctx());
    expect(t.decision).toBe("RECOVER");
    expect(t.recommendedAction).toBe("reminder");
    const eligible = t.scenarios.filter((s) => s.eligible && s.action !== "no_action").map((s) => s.incrementalContribution);
    expect(t.scenarios.find((s) => s.action === "reminder")!.incrementalContribution).toBe(Math.max(...eligible));
    expect(t.rejected.find((r) => r.action === "no_action")?.reason).toMatch(/expected to add/);
    expect(t.rejected).toHaveLength(5);
  });
  it("chooses service recovery when an unresolved issue is recorded, ahead of promotions", () => {
    const tx = regular("A", 25, 60, 10);
    tx[tx.length - 1] = { ...tx[tx.length - 1], serviceIssue: "Late delivery", serviceIssueResolved: "no" };
    const t = runTrial(profileOf(tx, "A"), ctx());
    expect(t.recommendedAction).toBe("service_recovery");
    expect(t.decision).toBe("RECOVER");
  });
  it("makes service recovery ineligible without a recorded issue", () => {
    const t = runTrial(profileOf(regular("A", 25, 45, 10), "A"), ctx());
    const sr = t.scenarios.find((s) => s.action === "service_recovery")!;
    expect(sr.eligible).toBe(false);
    expect(sr.ineligibleReason).toMatch(/No recorded service issue/);
  });
  it("chooses UNDERSTAND (check-in) when the reason for slowing down is unclear", () => {
    // irregular gaps, mixed categories → no replenishment pattern, no issue
    const cats = ["Gift Sets", "Brewing Equipment", "Tea", "Workshop", "Gift Sets", "Tea"];
    const tx = txFor("A", [700, 600, 420, 380, 250, 150], {}, 80).map((t, i) => ({ ...t, category: cats[i] }));
    const p = profileOf(tx, "A");
    const t = runTrial(p, ctx());
    expect(["slipping", "lapsed"]).toContain(p.status);
    expect(t.decision).toBe("UNDERSTAND");
    expect(t.recommendedAction).toBe("check_in");
  });
  it("increasing an assumption changes the recommendation immediately (simulator)", () => {
    const p = profileOf(regular("A", 25, 45, 10), "A");
    const a2 = structuredClone(A);
    a2.actions.discount.upliftPp = 0.3;
    a2.actions.discount.discountRate = 0.02;
    expect(runTrial(p, ctx({ assumptions: a2 })).recommendedAction).toBe("discount");
  });
  it("uncertainty range brackets the expected value", () => {
    const t = runTrial(profileOf(regular("A", 25, 45, 10), "A"), ctx());
    for (const s of t.scenarios) {
      expect(s.incrementalLow).toBeLessThanOrEqual(s.incrementalContribution + 1e-9);
      expect(s.incrementalHigh).toBeGreaterThanOrEqual(s.incrementalContribution - 1e-9);
    }
  });
});

describe("no-action recommendations", () => {
  it("HOLDs customers buying at their normal pace", () => {
    const t = runTrial(profileOf(regular("A", 30, 10), "A"), ctx());
    expect(t.decision).toBe("HOLD");
    expect(t.recommendedAction).toBe("no_action");
    expect(t.priorityScore).toBe(0);
  });
  it("HOLDs one-order customers for insufficient history", () => {
    const t = runTrial(profileOf(txFor("A", [300]), "A"), ctx());
    expect(t.decision).toBe("HOLD");
    expect(t.headline).toMatch(/insufficient history/);
  });
  it("HOLDs when the expected benefit does not justify the cost", () => {
    const a2 = structuredClone(A);
    a2.minIncrementalContribution = 1000;
    const t = runTrial(profileOf(regular("A", 25, 45, 10), "A"), ctx({ assumptions: a2 }));
    expect(t.decision).toBe("HOLD");
    expect(t.headline).toMatch(/does not justify/);
  });
});

describe("consent and opt-out suppression", () => {
  it("suppresses opted-out customers regardless of economics", () => {
    const t = runTrial(profileOf(regular("A", 25, 45, 10, { optedOut: "yes" }), "A"), ctx());
    expect(t.decision).toBe("HOLD");
    expect(t.suppression).toBe("opted_out");
    expect(t.scenarios.filter((s) => s.action !== "no_action").every((s) => !s.eligible)).toBe(true);
  });
  it("treats missing consent as no consent", () => {
    const t = runTrial(profileOf(regular("A", 25, 45, 10, { marketingConsent: undefined }), "A"), ctx());
    expect(t.suppression).toBe("no_consent");
    expect(t.decision).toBe("HOLD");
  });
  it("respects an opt-out recorded in intervention history", () => {
    const p = profileOf(regular("A", 25, 45, 10), "A");
    const iv: InterventionRecord[] = [{ customerId: "A", date: "2026-05-01", action: "reminder", group: "treatment", purchased: "no", optedOut: "yes", campaign: "x", source: "imported" }];
    expect(checkContactPolicy(p, iv, AS_OF, A).suppression).toBe("opted_out");
  });
  it("suppresses customers who declined, until the suppression ends", () => {
    const p = profileOf(regular("A", 25, 45, 10), "A");
    expect(runTrial(p, ctx({ suppressedUntil: { A: addDays(AS_OF, 30) } })).suppression).toBe("declined");
    expect(runTrial(p, ctx({ suppressedUntil: { A: AS_OF } })).suppression).toBeUndefined();
  });
});

describe("frequency caps", () => {
  const p = profileOf(regular("A", 25, 45, 10), "A");
  const contact = (daysAgo: number, group: InterventionRecord["group"] = "treatment"): InterventionRecord => ({ customerId: "A", date: addDays(AS_OF, -daysAgo), action: "check_in", group, purchased: "unknown", optedOut: "no", campaign: "c", source: "app" });
  it("blocks contact inside the minimum gap", () => {
    const r = checkContactPolicy(p, [contact(5)], AS_OF, A);
    expect(r.allowed).toBe(false);
    expect(r.suppression).toBe("frequency_cap");
    expect(runTrial(p, ctx({ interventions: [contact(5)] })).decision).toBe("HOLD");
  });
  it("blocks contact when the rolling 90-day cap is reached", () => {
    const r = checkContactPolicy(p, [contact(80), contact(40)], AS_OF, A);
    expect(r.allowed).toBe(false);
    expect(r.contactsLast90).toBe(2);
  });
  it("allows contact once the window has passed and ignores control-group records", () => {
    expect(checkContactPolicy(p, [contact(100), contact(95)], AS_OF, A).allowed).toBe(true);
    expect(checkContactPolicy(p, [contact(2, "control")], AS_OF, A).allowed).toBe(true);
  });
});
