import { describe, expect, it } from "vitest";
import { analyse } from "@/lib/analysis";
import { initConversation } from "@/lib/conversation";
import { createExperiment } from "@/lib/experiment";
import { appReducer, emptyState, isAppState, sampleState } from "@/lib/store";
import { DEFAULT_ASSUMPTIONS } from "@/lib/trial";

describe("reset functionality and state", () => {
  it("loads the synthetic sample through the validation pipeline", () => {
    const s = sampleState("t0");
    expect(s.dataSource).toBe("sample");
    expect(s.transactions.length).toBeGreaterThan(1000);
    expect(s.importSummary?.rejectedRows).toBe(0);
    expect(s.audit[0].type).toBe("data_loaded");
  });

  it("LOAD_SAMPLE resets experiments, conversations, suppressions and assumptions", () => {
    let s = sampleState("t0");
    s = appReducer(s, { type: "SET_ASSUMPTIONS", assumptions: { ...s.assumptions, marginRate: 0.9 }, note: "x", at: "t1" });
    s = appReducer(s, { type: "SAVE_CONVERSATION", conv: initConversation("C0001", "check_in", "hi") });
    s = appReducer(s, { type: "SUPPRESS", customerId: "C0001", days: 90, at: "t2" });
    s = appReducer(s, { type: "RECORD_SEND", customerId: "C0002", action: "reminder", at: "t3", detail: "d" });
    s = appReducer(s, { type: "CREATE_EXPERIMENT", experiment: createExperiment({ id: "E1", name: "n", startDate: s.asOf, windowDays: 30, seed: "x", holdoutShare: 0.5, marginRate: 0.4, candidates: [], createdAt: "t" }), at: "t4" });
    expect(s.experiments).toHaveLength(1);
    const r = appReducer(s, { type: "LOAD_SAMPLE", at: "t5" });
    expect(r.experiments).toHaveLength(0);
    expect(r.conversations).toEqual({});
    expect(r.suppressedUntil).toEqual({});
    expect(r.interventions.some((i) => i.source === "app")).toBe(false);
    expect(r.assumptions).toEqual(DEFAULT_ASSUMPTIONS);
    expect(r.audit[0].type).toBe("data_reset");
  });

  it("CLEAR_ALL empties everything", () => {
    const r = appReducer(sampleState("t0"), { type: "CLEAR_ALL", at: "t1" });
    expect(r.transactions).toHaveLength(0);
    expect(r.dataSource).toBe("empty");
    expect(analyse(r).profiles).toHaveLength(0);
  });

  it("RESET_ASSUMPTIONS restores defaults", () => {
    let s = emptyState();
    s = appReducer(s, { type: "SET_ASSUMPTIONS", assumptions: { ...s.assumptions, horizonDays: 30 }, note: "x", at: "t" });
    s = appReducer(s, { type: "RESET_ASSUMPTIONS", at: "t" });
    expect(s.assumptions).toEqual(DEFAULT_ASSUMPTIONS);
  });

  it("a simulated send activates the frequency cap for that customer", () => {
    let s = sampleState("t0");
    const target = Object.values(analyse(s).trials).find((t) => t.decision === "RECOVER")!.customerId;
    s = appReducer(s, { type: "RECORD_SEND", customerId: target, action: "reminder", at: "t1", detail: "d" });
    const t = analyse(s).trials[target];
    expect(t.decision).toBe("HOLD");
    expect(t.suppression).toBe("frequency_cap");
  });

  it("declining suppresses the customer", () => {
    let s = sampleState("t0");
    const target = Object.values(analyse(s).trials).find((t) => t.decision !== "HOLD")!.customerId;
    s = appReducer(s, { type: "SUPPRESS", customerId: target, days: 90, at: "t1" });
    expect(analyse(s).trials[target].suppression).toBe("declined");
  });

  it("validates persisted state before trusting it", () => {
    expect(isAppState(sampleState("t"))).toBe(true);
    expect(isAppState({ version: 2 })).toBe(false);
    expect(isAppState(null)).toBe(false);
  });

  it("sample data yields all three decision outcomes and real HOLDs", () => {
    const a = analyse(sampleState("t"));
    expect(a.counts.RECOVER).toBeGreaterThan(0);
    expect(a.counts.UNDERSTAND).toBeGreaterThan(0);
    expect(a.counts.HOLD).toBeGreaterThan(0);
    expect(a.suppressed.opted_out + a.suppressed.no_consent).toBeGreaterThan(0);
  });
});
