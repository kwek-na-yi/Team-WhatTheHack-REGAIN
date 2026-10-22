import { afterEach, describe, expect, it, vi } from "vitest";
import { analyse } from "@/lib/analysis";
import { answerQuestion, parseWhatIf, proposalAction, runWhatIf, type CopilotContext } from "@/lib/copilot";
import { buildModelFacts, parseModelFacts, validateModelText } from "@/lib/copilotGuard";
import { computeImpact, simulateOutcomes, type Experiment, type Outcome } from "@/lib/experiment";
import { appReducer, emptyState, sampleState, type AppState } from "@/lib/store";
import { runTrial } from "@/lib/trial";
import { AS_OF, regular, txFor } from "./helpers";

const AT = "2026-10-21T00:00:00Z";
const SAMPLE = sampleState(AT);
const SAMPLE_A = analyse(SAMPLE);
const ctxOf = (state: AppState, customerId: string | null = null): CopilotContext => ({ state, analysis: analyse(state), customerId });
const sampleCtx = (customerId: string | null = null): CopilotContext => ({ state: SAMPLE, analysis: SAMPLE_A, customerId });
const ask = (q: string, id: string | null = null) => answerQuestion(q, sampleCtx(id));
const firstWhere = (f: (id: string) => boolean) => Object.keys(SAMPLE_A.trials).find(f) as string;

const RECOVER_ID = "C0053";
const UNDERSTAND_ID = firstWhere((id) => SAMPLE_A.trials[id].decision === "UNDERSTAND");
const HOLD_ID = firstWhere((id) => SAMPLE_A.trials[id].decision === "HOLD" && !SAMPLE_A.trials[id].suppression);
const NO_CONSENT_ID = firstWhere((id) => SAMPLE_A.trials[id].suppression === "no_consent");
const OPTED_OUT_ID = firstWhere((id) => SAMPLE_A.trials[id].suppression === "opted_out");
const COMPLAINT_ID = firstWhere((id) => !!SAMPLE_A.byId[id].openServiceIssue && !SAMPLE_A.trials[id].suppression);
const NEW_ID = firstWhere((id) => ["new", "insufficient_history"].includes(SAMPLE_A.byId[id].status));

const fullText = (a: ReturnType<typeof ask>) => [a.summary, ...a.statements.map((s) => s.text), ...(a.comparison?.rows.map((r) => r.reason) ?? [])].join(" ");

/** Builds an experiment with fixed outcome counts. */
function experiment(t: [number, number], c: [number, number], source: Outcome["source"] = "manual", id = "EXP-1"): Experiment {
  const members: Experiment["members"] = [];
  const outcomes: Record<string, Outcome> = {};
  const add = (group: "treatment" | "control", n: number, buy: number) => {
    for (let i = 0; i < n; i++) {
      const cid = `${group[0]}${i}`;
      members.push({ customerId: cid, group, action: "reminder", assumedProb: 0.3, typicalOrderValue: 40, contactCost: 0.5, discountRate: 0, benefitCost: 0 });
      outcomes[cid] = { purchased: i < buy, revenue: i < buy ? 40 : 0, optedOut: false, negative: false, source };
    }
  };
  add("treatment", ...t);
  add("control", ...c);
  return { id, name: "Test", startDate: AS_OF, windowDays: 30, seed: "s", holdoutShare: 0.5, marginRate: 0.4, members, outcomes, createdAt: AT };
}

describe("A. explain my decision", () => {
  it("explains Recover, Understand and Hold using the engine's own decision", () => {
    for (const id of [RECOVER_ID, UNDERSTAND_ID, HOLD_ID]) {
      const a = ask("Explain this recommendation.", id);
      const t = SAMPLE_A.trials[id];
      expect(a.intent).toBe("explain");
      expect(a.customerId).toBe(id);
      expect(a.summary).toContain(t.reasons[0]);
      expect(a.summary).toMatch(t.decision === "HOLD" ? /is on Hold/ : t.decision === "RECOVER" ? /marked Recover/ : /marked Understand/);
      expect(a.comparison?.rows.find((r) => r.recommended)?.action).toBe(t.recommendedAction);
    }
  });

  it("separates observed facts, calculated indicators, unknowns and estimates", () => {
    const kinds = new Set(ask("What evidence supports this recommendation?", RECOVER_ID).statements.map((s) => s.kind));
    for (const k of ["fact", "indicator", "unknown", "estimate"]) expect(kinds.has(k as never)).toBe(true);
  });

  it("does not describe a customer with insufficient history as definitely at risk", () => {
    const a = ask("Why is this customer on Hold?", NEW_ID);
    expect(a.summary).toMatch(/isn't enough purchase history/);
    expect(a.summary).toMatch(/does not treat them as at risk/);
    expect(fullText(a)).not.toMatch(/\b(is|definitely|certainly) at risk\b/i);
    // Built from scratch: one order only.
    const s = { ...emptyState(), transactions: txFor("N1", [20]), asOf: AS_OF };
    const b = answerQuestion("Explain this recommendation.", ctxOf(s, "N1"));
    expect(b.summary).toMatch(/does not treat them as at risk/);
  });

  it("never infers unhappiness from inactivity", () => {
    for (const id of [RECOVER_ID, UNDERSTAND_ID, HOLD_ID]) expect(fullText(ask("Explain this recommendation.", id))).not.toMatch(/\b(is|was|seems|appears) (unhappy|dissatisfied|angry|frustrated)\b/i);
  });

  it("represents a recorded unresolved complaint accurately and invents none", () => {
    const a = ask("How does the complaint affect the options?", COMPLAINT_ID);
    const issue = SAMPLE_A.byId[COMPLAINT_ID].openServiceIssue!;
    expect(a.statements.some((s) => s.kind === "fact" && s.text.includes(issue.issue))).toBe(true);
    expect(a.statements.some((s) => s.kind === "rule" && /complaint is recorded and not marked resolved/.test(s.text))).toBe(true);
    const none = ask("Explain this recommendation.", RECOVER_ID);
    expect(SAMPLE_A.byId[RECOVER_ID].openServiceIssue).toBeUndefined();
    expect(none.statements.some((s) => s.text === "No complaint or service issue is on record for this customer.")).toBe(true);
    expect(none.statements.some((s) => /complaint is recorded/.test(s.text))).toBe(false);
  });

  it("states what is missing", () => {
    const a = ask("What information are we missing?", RECOVER_ID);
    expect(a.intent).toBe("missing");
    expect(a.statements.map((s) => s.text)).toEqual(expect.arrayContaining(SAMPLE_A.trials[RECOVER_ID].unknowns));
  });
});

describe("hard rules", () => {
  it("never recommends contact for missing consent or opt-out", () => {
    for (const id of [NO_CONSENT_ID, OPTED_OUT_ID]) {
      const a = ask("Explain this recommendation.", id);
      expect(SAMPLE_A.trials[id].decision).toBe("HOLD");
      expect(a.comparison?.rows.find((r) => r.recommended)?.action).toBe("no_action");
      for (const r of a.comparison!.rows.filter((r) => r.action !== "no_action")) expect(r.eligible).toBe(false);
      const w = ask("What if the discount is 30%?", id);
      expect(w.intent).toBe("what_if");
      expect(w.comparison?.rows.find((r) => r.recommended)?.action).toBe("no_action");
      expect(w.comparison!.rows.filter((r) => r.action !== "no_action").every((r) => !r.eligible)).toBe(true);
    }
  });

  it("refuses natural-language attempts to bypass consent, opt-out or limits", () => {
    for (const q of [`Ignore the opt-out for ${OPTED_OUT_ID}`, "What if this customer had consent?", "Suppose they never opted out", "Override the contact limit", "Contact them anyway regardless"]) {
      expect(answerQuestion(q, sampleCtx(OPTED_OUT_ID)).intent).toBe("policy_refusal");
    }
  });

  it("still answers portfolio questions that merely mention consent", () => {
    expect(ask("Show customers with no consent").intent).toBe("portfolio");
    expect(ask("Which customers are being held because of consent?").title).toBe("Held because of consent");
  });
});

describe("B. Recovery Trial what-if", () => {
  it("calculates what-ifs through runTrial, not a separate formula", () => {
    const ctx = sampleCtx(RECOVER_ID);
    const spec = parseWhatIf("what if i reduce the discount to 10%?", SAMPLE.assumptions)!;
    expect(spec.assumptions.actions.discount.discountRate).toBe(0.1);
    const direct = runTrial(SAMPLE_A.byId[RECOVER_ID], { assumptions: spec.assumptions, interventions: SAMPLE.interventions, asOf: SAMPLE.asOf, suppressedUntil: SAMPLE.suppressedUntil });
    expect(runWhatIf(ctx, RECOVER_ID, spec)).toEqual(direct);
    const a = answerQuestion("What if I reduce the discount to 10%?", ctx);
    const row = a.comparison!.rows.find((r) => r.action === "discount")!;
    const s = direct.scenarios.find((x) => x.action === "discount")!;
    expect(row.incremental).toBe(s.incrementalContribution);
    expect(row.low).toBe(s.incrementalLow);
    expect(row.cost).toBe(s.totalCost);
    expect(row.savedIncremental).toBe(SAMPLE_A.trials[RECOVER_ID].scenarios.find((x) => x.action === "discount")!.incrementalContribution);
    expect(a.comparison!.hypothetical).toBe(true);
  });

  it("does not mutate state; saving needs an explicit, non-stale confirmation", () => {
    const before = JSON.stringify(SAMPLE);
    const a = ask("What if I reduce the discount to 10%?", RECOVER_ID);
    ask("What if the customer had an unresolved complaint?", RECOVER_ID);
    expect(JSON.stringify(SAMPLE)).toBe(before);
    expect(a.summary).toMatch(/saved assumptions and the saved recommendation are unchanged/);
    const act = proposalAction(a.proposal!, SAMPLE.assumptions, AT)!;
    expect(act.type).toBe("SET_ASSUMPTIONS");
    const next = appReducer(SAMPLE, act);
    expect(next.assumptions.actions.discount.discountRate).toBe(0.1);
    expect(next.audit[0].detail).toMatch(/Decision Copilot \(confirmed by user\)/);
    // Stale preview: assumptions changed since — refused.
    expect(proposalAction(a.proposal!, next.assumptions, AT)).toBeNull();
  });

  it("labels a hypothetical complaint as hypothetical", () => {
    const a = ask("What if the customer had an unresolved complaint?", RECOVER_ID);
    expect(a.statements.some((s) => /hypothetical\. No complaint is on record/i.test(s.text))).toBe(true);
    expect(a.proposal).toBeUndefined();
  });

  it("explains unsupported scenarios instead of guessing", () => {
    const a = ask("What if the weather is bad?", RECOVER_ID);
    expect(a.intent).toBe("unsupported");
    expect(a.comparison).toBeUndefined();
  });

  it("compares with doing nothing and finds the best eligible alternative from engine output", () => {
    const t = SAMPLE_A.trials[RECOVER_ID];
    const c = ask("Compare it with doing nothing.", RECOVER_ID);
    expect(c.intent).toBe("compare");
    expect(c.comparison!.rows.find((r) => r.action === "no_action")).toMatchObject({ cost: 0, dependsOnAssumptions: false });
    const best = ask("Which alternative has the best estimated incremental contribution?", RECOVER_ID);
    const top = t.scenarios.filter((s) => s.eligible && s.action !== "no_action").sort((a, b) => b.incrementalContribution - a.incrementalContribution)[0];
    expect(best.summary).toContain(top.label);
  });
});

describe("C. portfolio investigator", () => {
  it("returns actual records and counts", () => {
    const complaints = SAMPLE_A.profiles.filter((p) => p.openServiceIssue).map((p) => p.customerId);
    const a = ask("Which customers have unresolved complaints and need attention?");
    expect(a.customers!.total).toBe(complaints.length);
    for (const c of a.customers!.cards) {
      expect(complaints).toContain(c.customerId);
      expect(c.decision).toBe(SAMPLE_A.trials[c.customerId].decision);
    }
    const review = ask("Who should I review first?");
    expect(review.customers!.total).toBe(SAMPLE_A.counts.RECOVER + SAMPLE_A.counts.UNDERSTAND);
    const scores = review.customers!.cards.map((c) => SAMPLE_A.trials[c.customerId].priorityScore);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
    const held = ask("Summarise the main reasons customers are being held.");
    expect(held.summary).toContain(`${SAMPLE_A.counts.HOLD} of ${SAMPLE_A.profiles.length}`);
    const consent = ask("Which customers are being held because of consent?");
    expect(consent.customers!.total).toBe(SAMPLE_A.suppressed.no_consent + SAMPLE_A.suppressed.opted_out);
  });

  it("caps cards rather than returning the whole dataset", () => {
    expect(ask("Who should I review first?").customers!.cards.length).toBeLessThanOrEqual(6);
  });

  it("gives an honest no-results answer", () => {
    const s = { ...emptyState(), transactions: [...regular("A", 25, 10, 8), ...regular("B", 30, 12, 8)], asOf: AS_OF };
    const a = answerQuestion("Show customers with unresolved complaints.", ctxOf(s));
    expect(a.customers).toEqual({ cards: [], total: 0 });
    expect(a.summary).toMatch(/^No customers match/);
    expect(a.summary).toContain("all 2 analysed customers");
    expect(answerQuestion("Who should I review first?", ctxOf(s)).customers!.total).toBe(0);
  });

  it("handles no data and unknown experiment IDs honestly", () => {
    expect(answerQuestion("Who should I review first?", ctxOf(emptyState())).intent).toBe("no_data");
    expect(ask("Did EXP-99 work?").summary).toBe("There is no experiment called EXP-99.");
  });

  it("asks for a customer when a case question has no active customer", () => {
    expect(ask("Explain this recommendation.").intent).toBe("need_customer");
  });
});

describe("D. experiment interpreter", () => {
  const withExp = (e: Experiment, dataSource: AppState["dataSource"] = "upload"): CopilotContext => ctxOf({ ...SAMPLE, dataSource, experiments: [e] });

  it("reports an inconclusive interval as inconclusive, not proof", () => {
    const e = experiment([30, 12], [30, 10]);
    const a = answerQuestion("Did this campaign work?", withExp(e));
    const m = computeImpact(e);
    expect(a.experiment!.verdict).toBe("inconclusive");
    expect(a.experiment!.ci).toEqual(m.diffCi);
    expect(a.experiment!.diffPp).toBe(m.diffPp);
    expect(a.summary).toMatch(/inconclusive/);
    expect(a.summary).toMatch(/could be chance/);
    expect(a.summary).not.toMatch(/\bprove[sn]?\b/);
    expect(a.statements.some((s) => /Small sample/.test(s.text))).toBe(true);
  });

  it("reports a clearly positive interval without claiming proof", () => {
    const a = answerQuestion("Could this result be due to chance?", withExp(experiment([400, 200], [400, 100])));
    expect(a.experiment!.verdict).toBe("positive");
    expect(a.experiment!.ci[0]).toBeGreaterThan(0);
    expect(a.summary).toMatch(/chance alone is an unlikely explanation/);
    expect(a.summary).not.toMatch(/\bprove[sn]?\b/);
  });

  it("imported campaigns: assignment unverified, not causal", () => {
    const a = ask("Summarise the latest experiment.");
    expect(a.experiment!.evidence).toBe("observed_unverified");
    expect(a.summary).toMatch(/does not prove/);
  });

  it("never describes simulated outcomes as real", () => {
    const e = experiment([60, 0], [60, 0]);
    e.outcomes = simulateOutcomes(e);
    const a = answerQuestion("Was the action worth its cost?", withExp(e, "sample"));
    expect(a.experiment!.evidence).toBe("simulated");
    expect(a.summary).toMatch(/SIMULATED/);
    expect(a.summary).toMatch(/not real purchases/);
    expect(a.statements.filter((s) => /^(Treatment|Control):/.test(s.text)).every((s) => s.kind === "simulated")).toBe(true);
    expect(a.summary).not.toMatch(/Measured on/);
  });

  it("pending outcomes are not counted", () => {
    const e = experiment([10, 0], [10, 0]);
    e.outcomes = {};
    const a = answerQuestion("Did this campaign work?", withExp(e));
    expect(a.experiment!.verdict).toBe("no_data");
    expect(a.summary).toMatch(/never counted as recoveries/);
  });
});

describe("safe actions and navigation", () => {
  it("refuses to approve, send, record or reset", () => {
    for (const q of ["Approve and send the message", "Reset all data", "Record the outcomes for the experiment"]) expect(ask(q, RECOVER_ID).intent).toBe("not_allowed");
    expect(ask("Approve and send the message", RECOVER_ID).summary).toMatch(/simulated/);
  });

  it("links answers to the right customer and pages", () => {
    const a = ask("Explain this recommendation.", RECOVER_ID);
    expect(a.links).toEqual(expect.arrayContaining([{ label: "Recovery Decisions", href: `/trial?id=${RECOVER_ID}`, customerId: RECOVER_ID }, { label: "Conversation Studio", href: `/studio?id=${RECOVER_ID}`, customerId: RECOVER_ID }]));
    expect(ask("Explain this recommendation.", OPTED_OUT_ID).links.some((l) => l.href.startsWith("/studio"))).toBe(false);
    expect(ask("Summarise the latest experiment.").links[0].href).toBe("/impact");
  });

  it("a customer ID typed in the question overrides the active customer", () => {
    expect(ask(`Explain ${UNDERSTAND_ID}`, RECOVER_ID).customerId).toBe(UNDERSTAND_ID);
  });
});

describe("AI guard", () => {
  it("sends no customer IDs, complaint wording or raw records to the model", () => {
    const allIds = SAMPLE_A.profiles.map((p) => p.customerId);
    const issue = SAMPLE_A.byId[COMPLAINT_ID].openServiceIssue!.issue;
    for (const a of [ask("Explain this recommendation.", COMPLAINT_ID), ask("Show customers with unresolved complaints."), ask("Who should I review first?")]) {
      const json = JSON.stringify(buildModelFacts(a, allIds));
      for (const id of allIds) expect(json).not.toContain(id);
      expect(json).not.toContain(issue);
      expect(json).not.toMatch(/@|customerId|orderId|marketingConsent/);
      expect(buildModelFacts(a, allIds).facts.length).toBeLessThanOrEqual(24);
    }
  });

  it("rejects invented numbers, overclaims, feelings and a dropped simulation label", () => {
    const facts = { title: "T", facts: ["Difference +9.5 pp; 95% interval -5.5 pp to +23.9 pp."], simulated: false };
    expect(validateModelText("The difference was +9.5 pp, an inconclusive result.", facts).ok).toBe(true);
    expect(validateModelText("The difference was 12 pp.", facts).ok).toBe(false);
    expect(validateModelText("This proves the reminder works.", facts).ok).toBe(false);
    expect(validateModelText("This does not prove the reminder works.", facts).ok).toBe(true);
    expect(validateModelText("The customer is unhappy.", facts).ok).toBe(false);
    expect(validateModelText("Results were good.", { ...facts, simulated: true }).ok).toBe(false);
    expect(validateModelText({ html: "<b>x</b>" }, facts).ok).toBe(false);
    expect(validateModelText("x".repeat(2000), facts).ok).toBe(false);
  });

  it("parses untrusted request bodies strictly", () => {
    expect(parseModelFacts(null)).toBeNull();
    expect(parseModelFacts({ facts: { title: "t", facts: [1] } })).toBeNull();
    const f = parseModelFacts({ facts: { title: "<t>", facts: Array(50).fill("<script>a</script>") } })!;
    expect(f.facts).toHaveLength(24);
    expect(f.title).not.toMatch(/[<>]/);
    expect(f.facts[0]).not.toMatch(/[<>]/);
  });
});

describe("/api/copilot route", () => {
  const facts = buildModelFacts(ask("Explain this recommendation.", RECOVER_ID), SAMPLE_A.profiles.map((p) => p.customerId));
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/copilot/route");
    const res = await POST(new Request("http://x/api/copilot", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as { source?: string; text?: string; note?: string } };
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back to deterministic wording with no API key", async () => {
    const { GET } = await import("@/app/api/copilot/route");
    expect(await (await GET()).json()).toMatchObject({ aiAvailable: false });
    const r = await post({ facts });
    expect(r.json.source).toBe("deterministic");
    expect(r.json.note).toMatch(/No AI provider configured/);
  });

  it("rejects malformed requests", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ facts: { title: 1 } })).status).toBe(400);
    expect((await post({ facts: { title: "t", facts: ["x".repeat(20_000)] } })).status).toBe(413);
  });

  it("survives provider failures, malformed and unsupported output", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const replies: (() => Promise<Response>)[] = [
      () => Promise.reject(new Error("timeout")),
      () => Promise.resolve(new Response("oops", { status: 500 })),
      () => Promise.resolve(new Response("not json", { status: 200 })),
      () => Promise.resolve(Response.json({ content: [{ type: "text", text: "This customer will spend $999 more." }] })),
    ];
    for (const r of replies) {
      vi.stubGlobal("fetch", vi.fn(r));
      const res = await post({ facts });
      expect(res.status).toBe(200);
      expect(res.json.source).toBe("deterministic");
    }
  });

  it("accepts a grounded rewording (mocked provider)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ content: [{ type: "text", text: "Customer A is marked Recover. A reminder is suggested." }] })));
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ facts });
    expect(res.json.source).toBe("ai");
    const sent = JSON.stringify((fetchMock.mock.calls[0] as unknown[])[1]);
    expect(sent).not.toContain(RECOVER_ID);
  });
});
