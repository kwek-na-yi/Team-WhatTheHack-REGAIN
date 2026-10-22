import { describe, expect, it } from "vitest";
import { buildProfiles, classifyStatus, groupOrders, purchaseIntervals, robustScale } from "@/lib/behaviour";
import { mad, median } from "@/lib/utils";
import { AS_OF, profileOf, regular, txFor } from "./helpers";

describe("purchase-interval calculations", () => {
  it("computes intervals between distinct purchase dates", () => {
    const orders = groupOrders(txFor("A", [90, 60, 30, 0]));
    expect(purchaseIntervals(orders)).toEqual([30, 30, 30]);
  });
  it("merges multiple lines of the same order and counts same-day orders as one visit", () => {
    const t = [...txFor("A", [60, 30]), { ...txFor("A", [30])[0], orderId: "A-1" , value: 10, category: "Tea" }, { ...txFor("A", [30])[0], orderId: "A-extra" }];
    const orders = groupOrders(t);
    expect(orders).toHaveLength(3);
    expect(orders.find((o) => o.orderId === "A-1")?.value).toBe(50);
    expect(orders.find((o) => o.orderId === "A-1")?.categories).toEqual(["Coffee Beans", "Tea"]);
    expect(purchaseIntervals(orders)).toEqual([30]);
  });
  it("median and MAD are robust", () => {
    expect(median([1, 2, 3, 100])).toBe(2.5);
    expect(mad([1, 2, 3, 100])).toBe(1);
    expect(median([])).toBeNull();
  });
  it("robust scale has a floor so perfectly regular customers are not flagged on a tiny slip", () => {
    expect(robustScale([30, 30, 30])).toBe(6); // 0.2 × median
    expect(robustScale([5, 5, 5])).toBe(3); // absolute 3-day floor
  });
  it("calculates recency, rhythm, overdue ratio and status", () => {
    const p = profileOf(regular("A", 30, 50), "A");
    expect(p.recencyDays).toBe(50);
    expect(p.medianInterval).toBe(30);
    expect(p.rhythmSource).toBe("personal");
    expect(p.overdueRatio).toBeCloseTo(1.67, 2);
    expect(p.status).toBe("slipping");
    expect(p.gapZScore).toBeCloseTo((50 - 30) / 6, 1);
  });
  it("classifies status thresholds", () => {
    expect(classifyStatus(1)).toBe("on_rhythm");
    expect(classifyStatus(1.5)).toBe("slipping");
    expect(classifyStatus(3)).toBe("lapsed");
    expect(classifyStatus(5)).toBe("dormant");
  });
  it("uses the median order value so one large order does not inflate the typical value", () => {
    const t = [...regular("A", 30, 10, 6), { ...txFor("A", [200])[0], orderId: "big", value: 900 }];
    const p = profileOf(t, "A");
    expect(p.typicalOrderValue).toBe(40);
    expect(p.outlierOrderIds).toContain("big");
    expect(p.meanOrderValue).toBeGreaterThan(100);
  });
  it("detects spend trend and lengthening intervals", () => {
    const p = profileOf(txFor("A", [360, 345, 330, 315, 300, 285, 270, 200, 100]), "A");
    expect(p.intervalsLengthening).toBe(true);
    expect(p.spendTrend).not.toBeNull();
    expect(p.spendTrend as number).toBeLessThan(0);
  });
  it("ignores transactions after the analysis date", () => {
    const t = [...regular("A", 30, 40, 5), { ...txFor("A", [0])[0], orderId: "future", date: "2026-10-15" }];
    const p = buildProfiles(t, { asOf: AS_OF })[0];
    expect(p.lastOrderDate < "2026-10-01").toBe(true);
  });
});

describe("sparse and missing data", () => {
  it("one order: insufficient history (or new), no personal rhythm, population interval used as context only", () => {
    const old = profileOf(txFor("A", [300]), "A");
    expect(old.status).toBe("insufficient_history");
    expect(old.rhythmSource).toBe("population");
    expect(old.gapZScore).toBeNull();
    expect(old.evidence.some((e) => e.text.includes("Insufficient history to estimate a personal purchasing rhythm"))).toBe(true);
    const recent = profileOf(txFor("B", [5]), "B");
    expect(recent.status).toBe("new");
  });
  it("two orders: provisional rhythm, flagged as a limitation", () => {
    const p = profileOf(txFor("A", [100, 60]), "A");
    expect(p.rhythmSource).toBe("provisional");
    expect(p.limitations.some((l) => l.includes("Only 2 order"))).toBe(true);
    expect(p.evidenceLevel).toBe("low");
  });
  it("missing consent is reported as unknown, never assumed", () => {
    const p = profileOf(txFor("A", [90, 60, 30], { marketingConsent: undefined, optedOut: undefined }), "A");
    expect(p.marketingConsent).toBe("unknown");
    expect(p.evidence.some((e) => e.kind === "unknown" && e.text.includes("NOT contactable"))).toBe(true);
  });
  it("never diagnoses dissatisfaction from inactivity alone", () => {
    const p = profileOf(regular("A", 30, 120), "A");
    expect(p.evidence.some((e) => e.kind === "unknown" && e.text.includes("Inactivity alone does not show dissatisfaction"))).toBe(true);
    expect(p.evidence.filter((e) => e.kind === "explanation").every((e) => !/dissatisf/i.test(e.text))).toBe(true);
  });
  it("keeps facts, indicators, explanations and unknowns separate", () => {
    const p = profileOf(regular("A", 30, 70), "A");
    const kinds = new Set(p.evidence.map((e) => e.kind));
    expect(kinds).toEqual(new Set(["fact", "indicator", "explanation", "unknown"]));
  });
});
