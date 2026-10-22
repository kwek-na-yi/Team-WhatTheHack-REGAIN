import { describe, expect, it } from "vitest";
import { analyseHistorical, assignGroup, computeImpact, createExperiment, measureOutcomes, newcombeDiff, normCdf, sampleSizePerArm, simulateOutcomes, twoProportionP, wilson, type Experiment, type ExperimentCandidate } from "@/lib/experiment";
import type { InterventionRecord, Transaction } from "@/lib/types";

const cands = (n: number): ExperimentCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ customerId: `C${i}`, action: "reminder", typicalOrderValue: 40, contactCost: 0.5, discountRate: 0, benefitCost: 0, baselineProb: 0.2, actionProb: 0.3 }));
const mk = (n = 400, share = 0.5, seed = "s1"): Experiment =>
  createExperiment({ id: "E1", name: "t", startDate: "2026-09-30", windowDays: 30, seed, holdoutShare: share, marginRate: 0.4, candidates: cands(n), createdAt: "x" });

describe("treatment/control assignment", () => {
  it("is reproducible for the same seed and differs for another seed", () => {
    const a = mk().members.map((m) => m.group);
    expect(mk().members.map((m) => m.group)).toEqual(a);
    expect(mk(400, 0.5, "other").members.map((m) => m.group)).not.toEqual(a);
    expect(assignGroup("C1", "s", 0.3)).toBe(assignGroup("C1", "s", 0.3));
  });
  it("respects the holdout share approximately", () => {
    const e = mk(2000, 0.2);
    const share = e.members.filter((m) => m.group === "control").length / 2000;
    expect(share).toBeGreaterThan(0.17);
    expect(share).toBeLessThan(0.23);
  });
  it("uses baseline probability for control and action probability for treatment", () => {
    const e = mk(50);
    for (const m of e.members) expect(m.assumedProb).toBe(m.group === "control" ? 0.2 : 0.3);
  });
});

describe("statistics", () => {
  it("normal CDF and Wilson intervals", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    const [l, u] = wilson(50, 100);
    expect(l).toBeCloseTo(0.4038, 3);
    expect(u).toBeCloseTo(0.5962, 3);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
  it("Newcombe interval contains the point difference; p-value sensible", () => {
    const [l, u] = newcombeDiff(30, 100, 20, 100);
    expect(l).toBeLessThan(0.1);
    expect(u).toBeGreaterThan(0.1);
    expect(l).toBeLessThan(0); // n=100 per arm cannot distinguish 30% vs 20% reliably
    expect(twoProportionP(30, 100, 20, 100)).toBeGreaterThan(0.05);
    expect(twoProportionP(300, 1000, 200, 1000)).toBeLessThan(0.001);
  });
  it("sample size per arm", () => {
    expect(sampleSizePerArm(0.2, 0.3)).toBe(291);
    expect(sampleSizePerArm(0.2, 0.2)).toBe(Infinity);
  });
});

describe("impact metrics", () => {
  it("computes rates, differences, incremental purchases, revenue and contribution", () => {
    const e = mk(4);
    e.members = [
      { ...e.members[0], customerId: "T1", group: "treatment" },
      { ...e.members[1], customerId: "T2", group: "treatment" },
      { ...e.members[2], customerId: "C1", group: "control" },
      { ...e.members[3], customerId: "C2", group: "control" },
    ];
    e.outcomes = {
      T1: { purchased: true, revenue: 40, optedOut: false, negative: false, source: "manual" },
      T2: { purchased: false, revenue: 0, optedOut: true, negative: true, source: "manual" },
      C1: { purchased: false, revenue: 0, optedOut: false, negative: false, source: "manual" },
      C2: { purchased: false, revenue: 0, optedOut: false, negative: false, source: "manual" },
    };
    const m = computeImpact(e);
    expect(m.treatment.rate).toBe(0.5);
    expect(m.control.rate).toBe(0);
    expect(m.diffPp).toBe(0.5);
    expect(m.incrementalPurchases).toBe(1);
    expect(m.incrementalRevenue).toBe(40);
    expect(m.interventionCost).toBe(1);
    expect(m.incrementalContribution).toBeCloseTo(40 * 0.4 - 1);
    expect(m.treatment.optOuts).toBe(1);
    expect(m.warnings.some((w) => w.includes("Small sample"))).toBe(true);
  });
  it("excludes pending outcomes and never counts them as recoveries", () => {
    const e = mk(10);
    const m = computeImpact(e);
    expect(m.treatment.observed + m.control.observed).toBe(0);
    expect(m.treatment.purchases).toBe(0);
    expect(m.warnings.some((w) => w.includes("pending"))).toBe(true);
  });
  it("labels simulated outcomes and is reproducible", () => {
    const e = mk(300);
    const o1 = simulateOutcomes(e, 1);
    expect(o1).toEqual(simulateOutcomes(e, 1));
    expect(Object.values(o1).every((o) => o.source === "simulated")).toBe(true);
    const m = computeImpact({ ...e, outcomes: o1 });
    expect(m.sources).toContain("simulated");
    expect(m.warnings[0]).toMatch(/SIMULATED/);
  });
  it("measures outcomes from transactions: purchase in window = yes, window open & none = pending", () => {
    const e = mk(3);
    const tx: Transaction[] = [{ customerId: e.members[0].customerId, orderId: "x", date: "2026-10-05", value: 50, category: "c" }];
    const open = measureOutcomes(e, tx, "2026-10-10");
    expect(open[e.members[0].customerId].purchased).toBe(true);
    expect(open[e.members[1].customerId].purchased).toBeNull();
    const closed = measureOutcomes(e, tx, "2026-11-30");
    expect(closed[e.members[1].customerId].purchased).toBe(false);
    expect(closed[e.members[0].customerId].revenue).toBe(50);
  });
  it("analyses imported campaigns with a control group", () => {
    const rec = (id: string, group: "treatment" | "control", purchased: "yes" | "no"): InterventionRecord => ({ customerId: id, date: "2026-05-01", action: group === "control" ? "none" : "reminder", group, purchased, optedOut: "no", campaign: "May", source: "imported" });
    const rs = [rec("a", "treatment", "yes"), rec("b", "treatment", "no"), rec("c", "control", "no"), rec("d", "control", "no")];
    const h = analyseHistorical(rs);
    expect(h).toHaveLength(1);
    expect(h[0].diffPp).toBe(0.5);
    expect(h[0].assignmentVerified).toBe(false);
  });
});
