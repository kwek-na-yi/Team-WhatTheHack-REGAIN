"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { now, useApp } from "@/components/AppProvider";
import { AXIS, CHART, tooltipProps } from "@/components/chartTheme";
import { AssumptionTag, Button, Card, DataGate, Disclosure, DisclosureGroup, EmptyState, Notice, PageHeader, Pager, selectCls, SimulatedTag, Source, Stat, StatGroup, Tag, td, th, TipText } from "@/components/ui";
import { GLOSSARY } from "@/lib/present";
import {
  analyseHistorical,
  computeImpact,
  createExperiment,
  measureOutcomes,
  sampleSizePerArm,
  simulateOutcomes,
  wilson,
  type Experiment,
  type ExperimentCandidate,
  type HistoricalComparison,
  type Outcome,
} from "@/lib/experiment";
import { ACTION_LABEL } from "@/lib/trial";
import type { ActionId } from "@/lib/types";
import { addDays, csvSafe, fmtMoney, fmtPct, fmtPp } from "@/lib/utils";

export default function ImpactPage() {
  return (
    <DataGate>
      <Inner />
    </DataGate>
  );
}

type Evidence = "simulated" | "observed" | "randomised" | "pending";

/** One shape for both imported campaigns and REGAIN experiments, so the page renders them identically. */
interface Result {
  key: string;
  title: string;
  period: string;
  evidence: Evidence;
  t: { n: number; purchases: number; rate: number; ci: [number, number]; optOuts: number; pending: number };
  c: { n: number; purchases: number; rate: number; ci: [number, number]; pending: number };
  diff: number;
  diffCi: [number, number];
  pValue: number | null;
  econ: null | { revenue: number; margin: number; interventionCost: number; discountCost: number; contribution: number; negatives: number };
  requiredPerArm: number | null;
  historical?: HistoricalComparison;
  experiment?: Experiment;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const EVIDENCE: Record<Evidence, { label: string; tone: "plum" | "outline" | "green" | "neutral"; text: string }> = {
  simulated: { label: "Simulated", tone: "plum", text: "Outcomes were generated from REGAIN's own assumptions. They show how measurement works — not real behaviour — and can't be used to update assumptions." },
  observed: { label: "Observed · assignment not verified", tone: "outline", text: "Outcomes come from your records. REGAIN can't verify how groups were chosen; if not at random, the difference may reflect who was picked rather than the message." },
  randomised: { label: "Randomised test", tone: "green", text: "Groups were assigned at random by REGAIN, so the difference estimates the causal effect — within the uncertainty shown." },
  pending: { label: "Awaiting outcomes", tone: "neutral", text: "No outcomes yet. Customers still inside the measurement window are excluded and never counted as recoveries." },
};

function Line({ label, value, strong, tip }: { label: string; value: ReactNode; strong?: boolean; tip?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-line py-2.5 text-sm last:border-0 ${strong ? "font-semibold text-ink" : "text-ink-soft"}`}>
      <span>{tip ? <TipText text={tip}>{label}</TipText> : label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Inner() {
  const { state, dispatch, analysis } = useApp();
  const historical = useMemo(() => analyseHistorical(state.interventions), [state.interventions]);
  const [sel, setSel] = useState<string>("");
  const [holdout, setHoldout] = useState(0.5);
  const [seed, setSeed] = useState("regain-oct26");
  const [windowDays, setWindowDays] = useState(30);
  const [calibrated, setCalibrated] = useState<string | null>(null);

  const results: Result[] = useMemo(() => {
    const out: Result[] = [];
    for (const e of state.experiments) {
      const m = computeImpact(e);
      const ev: Evidence = m.sources.includes("simulated") ? "simulated" : m.treatment.observed + m.control.observed === 0 ? "pending" : "randomised";
      out.push({
        key: e.id,
        title: `${e.id} · ${e.name}`,
        period: `${e.startDate} → ${addDays(e.startDate, e.windowDays)} (${e.windowDays} days)`,
        evidence: ev,
        t: { n: m.treatment.observed, purchases: m.treatment.purchases, rate: m.treatment.rate, ci: m.treatment.rateCi, optOuts: m.treatment.optOuts, pending: m.treatment.pending },
        c: { n: m.control.observed, purchases: m.control.purchases, rate: m.control.rate, ci: m.control.rateCi, pending: m.control.pending },
        diff: m.diffPp,
        diffCi: m.diffCi,
        pValue: m.pValue,
        econ: { revenue: m.incrementalRevenue, margin: e.marginRate, interventionCost: m.interventionCost, discountCost: m.discountCost, contribution: m.incrementalContribution, negatives: m.treatment.negatives + m.control.negatives },
        requiredPerArm: m.requiredPerArm,
        experiment: e,
      });
    }
    for (const h of historical) {
      const tr = h.treatment.purchases / h.treatment.n;
      const cr = h.control.purchases / h.control.n;
      out.push({
        key: `hist:${h.campaign}:${h.action}`,
        title: `${h.campaign} — ${ACTION_LABEL[h.action as ActionId] ?? h.action}`,
        period: `From ${h.date}`,
        evidence: "observed",
        t: { n: h.treatment.n, purchases: h.treatment.purchases, rate: tr, ci: wilson(h.treatment.purchases, h.treatment.n), optOuts: h.treatment.optOuts, pending: 0 },
        c: { n: h.control.n, purchases: h.control.purchases, rate: cr, ci: wilson(h.control.purchases, h.control.n), pending: 0 },
        diff: h.diffPp,
        diffCi: h.diffCi,
        pValue: h.pValue,
        econ: null,
        requiredPerArm: sampleSizePerArm(cr, Math.min(0.99, cr + Math.max(0.01, h.diffPp))),
        historical: h,
      });
    }
    return out;
  }, [state.experiments, historical]);

  useEffect(() => {
    if (!results.find((r) => r.key === sel) && results[0]) setSel(results[0].key);
  }, [results, sel]);
  const r = results.find((x) => x.key === sel) ?? results[0];

  const candidates: ExperimentCandidate[] = useMemo(
    () =>
      Object.values(analysis.trials)
        .filter((t) => t.decision !== "HOLD")
        .map((t) => {
          const s = t.scenarios.find((x) => x.action === t.recommendedAction)!;
          const cfg = state.assumptions.actions[t.recommendedAction as Exclude<ActionId, "no_action">];
          return { customerId: t.customerId, action: t.recommendedAction, typicalOrderValue: analysis.byId[t.customerId].typicalOrderValue, contactCost: cfg.contactCost, discountRate: cfg.discountRate, benefitCost: cfg.benefitCost, baselineProb: s.baselineProb, actionProb: s.actionProb };
        }),
    [analysis, state.assumptions],
  );
  const avgP0 = candidates.length ? candidates.reduce((a, c) => a + c.baselineProb, 0) / candidates.length : 0;
  const avgP1 = candidates.length ? candidates.reduce((a, c) => a + c.actionProb, 0) / candidates.length : 0;
  const needed = sampleSizePerArm(avgP0, avgP1);
  const smallerArm = Math.round(candidates.length * Math.min(holdout, 1 - holdout));

  const create = () => {
    const e = createExperiment({ id: `EXP-${String(state.experiments.length + 1).padStart(2, "0")}`, name: `Recovery holdout ${state.asOf}`, startDate: state.asOf, windowDays, seed, holdoutShare: holdout, marginRate: state.assumptions.marginRate, candidates, createdAt: now() });
    dispatch({ type: "CREATE_EXPERIMENT", experiment: e, at: now() });
    setSel(e.id);
  };
  const setOutcomes = (e: Experiment, o: Record<string, Outcome>, note: string) => dispatch({ type: "SET_OUTCOMES", experimentId: e.id, outcomes: o, note, at: now() });
  const calibrate = (h: HistoricalComparison) => {
    const a = h.action as Exclude<ActionId, "no_action">;
    if (!state.assumptions.actions[a]) return;
    const v = Math.max(0, Number(h.diffPp.toFixed(3)));
    dispatch({
      type: "SET_ASSUMPTIONS",
      assumptions: { ...state.assumptions, actions: { ...state.assumptions.actions, [a]: { ...state.assumptions.actions[a], upliftPp: v } } },
      note: `LEARN: ${ACTION_LABEL[a]} uplift calibrated to ${fmtPp(v)} from campaign "${h.campaign}" (observed, not verified as randomised; window may differ from horizon).`,
      at: now(),
    });
    setCalibrated(`${ACTION_LABEL[a]} estimate updated: lift set to ${fmtPp(v)}. All decisions recalculated.`);
  };

  const hasData = r && r.t.n + r.c.n > 0;
  const crosses = r && hasData && r.diffCi[0] < 0 && r.diffCi[1] > 0;
  const small = r && (r.t.n < 100 || r.c.n < 100);
  const isSim = r?.evidence === "simulated";
  // One plain-English sentence describing the result — derived from the numbers, never overstated.
  const plain = !r || !hasData
    ? "No outcomes are recorded yet, so there is nothing to compare."
    : [
        `Customers who received the action bought again ${fmtPct(r.t.rate, 1)} of the time, compared with ${fmtPct(r.c.rate, 1)} for those who did not — a difference of ${fmtPp(r.diff)}.`,
        crosses ? "The likely range includes zero, so the difference could be chance." : r.diff > 0 ? "The difference is unlikely to be chance alone." : "The action appears to have lowered repeat purchases.",
        isSim ? "These results are simulated from REGAIN's own estimates." : r.evidence === "observed" ? "The groups were not verified as random, so this does not prove the action caused the difference." : "",
      ].filter(Boolean).join(" ");
  const chart = r
    ? [
        { name: "Received the action", rate: r.t.rate * 100, err: [(r.t.rate - r.t.ci[0]) * 100, (r.t.ci[1] - r.t.rate) * 100], n: r.t.n },
        { name: "Did not receive it", rate: r.c.rate * 100, err: [(r.c.rate - r.c.ci[0]) * 100, (r.c.ci[1] - r.c.rate) * 100], n: r.c.n },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Impact & Experiments"
        subtitle="Did the recovery action add value — and how sure can we be?"
        actions={
          results.length > 0 && (
            <select aria-label="Result to show" className={`${selectCls} min-w-[260px]`} value={r?.key} onChange={(e) => setSel(e.target.value)}>
              {results.map((x) => <option key={x.key} value={x.key}>{x.title}</option>)}
            </select>
          )
        }
      />

      {!r ? (
        <EmptyState title="No results yet" action={<Button variant="primary" onClick={create} disabled={candidates.length < 2}>Create a holdout experiment</Button>}>
          Import a campaign with a control group, or start an experiment with the customers REGAIN recommends contacting.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <span className="text-ink">{EVIDENCE[r.evidence].label}</span>
              <span className="text-ink-faint">·</span>
              <span>{r.period}</span>
              <span className="text-ink-muted">·</span>
              <span>{r.t.n} received the action vs {r.c.n} did not{r.t.pending + r.c.pending ? ` · ${r.t.pending + r.c.pending} pending` : ""}</span>
            </div>
            {r.experiment && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onMeasure(r.experiment!)}>Measure from transactions</Button>
                <Button size="sm" onClick={() => setOutcomes(r.experiment!, simulateOutcomes(r.experiment!, 1), `SIMULATED outcomes generated for ${r.experiment!.id} from REGAIN assumptions (seeded).`)}>Simulate outcomes (labelled)</Button>
              </div>
            )}
          </div>

          {isSim && <div className="mb-4"><Notice tone="sim"><b>Simulated results.</b> Generated from REGAIN&apos;s assumptions to demonstrate the method. Not evidence of real impact.</Notice></div>}

          <section className="mb-6 rounded-lg border border-line border-l-2 border-l-plum-accent bg-surface px-5 py-4 shadow-card" aria-label="Result in plain English">
            <div className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">What this means</div>
            <p className="mt-1 text-[15px] leading-relaxed text-ink">{plain}</p>
          </section>

          <StatGroup>
            <Stat label="Received the action" tip={GLOSSARY.repeatRate} value={hasData && r.t.n ? fmtPct(r.t.rate, 1) : "—"} hint={`Repeat-purchase rate · ${r.t.purchases} of ${r.t.n} bought`} tag={isSim ? <SimulatedTag /> : undefined} />
            <Stat label="Did not receive it" tip={GLOSSARY.repeatRate} value={hasData && r.c.n ? fmtPct(r.c.rate, 1) : "—"} hint={`Repeat-purchase rate · ${r.c.purchases} of ${r.c.n} bought`} tag={isSim ? <SimulatedTag /> : undefined} />
            <Stat label="Difference" value={hasData ? fmtPp(r.diff) : "—"} hint={hasData ? `Likely range ${fmtPp(r.diffCi[0])} to ${fmtPp(r.diffCi[1])}` : "Needs outcomes in both groups"} tone={hasData && !crosses ? (r.diff > 0 ? "good" : "bad") : undefined} tip={`${GLOSSARY.difference} ${GLOSSARY.interval}`} />
            <Stat
              label="Extra contribution"
              tip={GLOSSARY.extraContribution}
              value={r.econ ? fmtMoney(r.econ.contribution) : "Not recorded"}
              hint={r.econ ? "After contact and discount costs" : "Campaign has no revenue data"}
              tone={r.econ && r.econ.contribution < 0 ? "bad" : undefined}
              tag={isSim ? <SimulatedTag /> : undefined}
            />
          </StatGroup>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card title="Who bought again?" subtitle={`Repeat-purchase rate with likely range · ${r.period}`} right={isSim ? <SimulatedTag /> : <Source kind="observed" />}>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={chart} margin={{ top: 16, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
                    <Tooltip {...tooltipProps} formatter={(v: number) => [`${v.toFixed(1)}%`, "Repeat-purchase rate"]} />
                    <Bar isAnimationActive={false} dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={72}>
                      <Cell fill={CHART.primary} />
                      <Cell fill={CHART.compare} />
                      <LabelList dataKey="n" position="insideBottom" formatter={(n: number) => `n = ${n}`} style={{ fontSize: 12, fill: "#FFFFFF", fontWeight: 600 }} />
                      <ErrorBar dataKey="err" width={8} stroke={CHART.whisker} strokeWidth={1.5} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="How reliable is this?">
              <div className="flex items-center gap-2"><Tag tone={EVIDENCE[r.evidence].tone}>{EVIDENCE[r.evidence].label}</Tag></div>
              <p className="mt-2 text-sm text-ink-soft">{EVIDENCE[r.evidence].text}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {hasData && crosses && <li className="text-crimson-text">The likely range includes zero — the action may have had no effect.</li>}
                {hasData && small && <li className="text-crimson-text">Small sample. ~{r.requiredPerArm ?? "—"} per group needed to detect this difference reliably.</li>}
                {hasData && !crosses && !small && <li className="text-good">The difference is unlikely to be chance alone at this sample size.</li>}
                {r.t.pending + r.c.pending > 0 && <li className="text-ink-muted">{r.t.pending + r.c.pending} pending customers excluded — not counted as recoveries.</li>}
              </ul>
              {r.historical && (
                <div className="mt-5 border-t border-line pt-4">
                  <div className="text-sm font-medium text-ink">Use this evidence</div>
                  <p className="mt-1 text-sm text-ink-soft">
                    Replace the estimated {ACTION_LABEL[r.historical.action as ActionId]?.toLowerCase() ?? r.historical.action} lift ({fmtPp(state.assumptions.actions[r.historical.action as Exclude<ActionId, "no_action">]?.upliftPp ?? 0)}) with the observed {fmtPp(Math.max(0, r.diff))}.
                  </p>
                  <div className="mt-3"><Button size="sm" variant="primary" disabled={!state.assumptions.actions[r.historical.action as Exclude<ActionId, "no_action">]} onClick={() => calibrate(r.historical!)}>Update the estimate with this result</Button></div>
                  {calibrated && <div className="mt-3"><Notice tone="success">{calibrated}</Notice></div>}
                </div>
              )}
              {isSim && <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">Simulated results can&apos;t be used to update estimates.</p>}
            </Card>
          </div>

          <Card title="Was it worth the money?" subtitle="Extra revenue and costs for customers who received the action" className="mt-6" right={isSim ? <SimulatedTag /> : undefined}>
            {r.econ ? (
              <div className="grid gap-x-10 md:grid-cols-2">
                <div>
                  <Line label="Extra revenue" value={fmtMoney(r.econ.revenue, 2)} tip="(Revenue per customer who received the action − per customer who did not) × customers who received it." />
                  <Line label={`Margin on extra revenue (${fmtPct(r.econ.margin)})`} value={fmtMoney(r.econ.revenue * r.econ.margin, 2)} />
                  <Line label="Recovery action costs" value={`− ${fmtMoney(r.econ.interventionCost, 2)}`} />
                  <Line label="Discounts paid" value={`− ${fmtMoney(r.econ.discountCost, 2)}`} />
                  <Line label="Extra contribution" value={<span className={r.econ.contribution < 0 ? "text-crimson-text" : "text-good"}>{fmtMoney(r.econ.contribution, 2)}</span>} strong tip={GLOSSARY.extraContribution} />
                </div>
                <div>
                  <Line label="Extra purchases" value={hasData ? (r.diff * r.t.n).toFixed(1) : "—"} tip="(Rate for those who received the action − rate for those who did not) × customers who received it." />
                  <Line label="Opt-outs after the action" value={r.t.optOuts} />
                  <Line label="Negative responses" value={r.econ.negatives} />
                  <Line label="p-value" value={r.pValue === null ? "—" : r.pValue.toFixed(3)} tip={GLOSSARY.pValue} />
                </div>
              </div>
            ) : (
              <div className="grid gap-x-10 md:grid-cols-2">
                <div>
                  <Line label="Extra purchases" value={(r.diff * r.t.n).toFixed(1)} />
                  <Line label="Opt-outs after the action" value={r.t.optOuts} />
                  <Line label="p-value" value={r.pValue === null ? "—" : r.pValue.toFixed(3)} tip={GLOSSARY.pValue} />
                </div>
                <p className="mt-3 text-sm text-ink-muted md:mt-0">This campaign only records whether customers bought, not order values or costs — so revenue and contribution can&apos;t be calculated.</p>
              </div>
            )}
          </Card>
        </>
      )}

      <DisclosureGroup className="mt-7">
        <Disclosure flush title="Set up a new holdout experiment" hint={`Test it properly · ${candidates.length} eligible customers`}>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4 text-sm">
              <p className="text-ink-soft">Customers marked Recover or Understand are split at random: some receive the action, the rest don&apos;t. Comparing the two groups shows what the action really did. Customers who can&apos;t be contacted are excluded.</p>
              <label className="block">
                <div className="flex justify-between"><span className="text-ink-soft">Share who won&apos;t receive the action (holdout)</span><b className="tabular-nums">{fmtPct(holdout)}</b></div>
                <input type="range" className="mt-1 w-full" min={0.1} max={0.5} step={0.05} value={holdout} onChange={(e) => setHoldout(Number(e.target.value))} aria-label="Holdout share" />
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-ink-soft">Seed <input value={seed} onChange={(e) => setSeed(e.target.value.slice(0, 40))} className="h-9 w-36 rounded-lg border border-line-strong px-2 font-mono text-sm text-ink" /></label>
                <label className="flex items-center gap-2 text-ink-soft">Window <input type="number" min={7} max={180} value={windowDays} onChange={(e) => setWindowDays(Math.max(7, Math.min(180, Number(e.target.value) || 30)))} className="h-9 w-20 rounded-lg border border-line-strong px-2 text-sm text-ink" /> days</label>
              </div>
              <Button variant="primary" onClick={create} disabled={candidates.length < 2}>Create experiment</Button>
            </div>
            <div className="rounded-lg bg-canvas p-4 text-sm text-ink-soft">
              <div className="mb-1 flex items-center gap-2 font-medium text-ink">Power check <AssumptionTag /></div>
              <p>Estimated repeat rate: {fmtPct(avgP1, 1)} with the action vs {fmtPct(avgP0, 1)} without.</p>
              <p className="mt-1">Needed for a reliable answer: <b className="text-ink">{Number.isFinite(needed) ? needed.toLocaleString() : "∞"}</b> per group. This design gives ≈ <b className="text-ink">{smallerArm}</b>.</p>
              {smallerArm < needed && <p className="mt-2 text-crimson-text">Too few customers — treat results as directional, or run over several cycles.</p>}
            </div>
          </div>
        </Disclosure>

        {r?.experiment && <OutcomeRecords exp={r.experiment} onOutcomes={setOutcomes} onDelete={() => dispatch({ type: "DELETE_EXPERIMENT", experimentId: r.experiment!.id, at: now() })} />}

        <Disclosure flush title="How the comparison works">
          <div className="grid gap-5 text-sm text-ink-soft md:grid-cols-3">
            <p><b className="text-ink">Why keep some customers out?</b> Many customers would have bought anyway. Without a comparison group they would be wrongly counted as recovered.</p>
            <p><b className="text-ink">Random assignment.</b> A hash of seed + customer ID picks the holdout, so groups differ only by chance and are reproducible.</p>
            <p><b className="text-ink">Honest reporting.</b> Wilson intervals per group, Newcombe interval for the difference, two-proportion z-test. Pending outcomes are excluded.</p>
          </div>
        </Disclosure>
      </DisclosureGroup>
    </>
  );

  function onMeasure(e: Experiment) {
    setOutcomes(e, measureOutcomes(e, state.transactions, state.asOf), `Outcomes for ${e.id} measured from transaction data (as of ${state.asOf}).`);
  }
}

function OutcomeRecords({ exp, onOutcomes, onDelete }: { exp: Experiment; onOutcomes: (e: Experiment, o: Record<string, Outcome>, note: string) => void; onDelete: () => void }) {
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const PAGE = 15;
  const rows = exp.members.slice(page * PAGE, page * PAGE + PAGE);
  const setOne = (id: string, patch: Partial<Outcome>) => {
    const prev = exp.outcomes[id] ?? { purchased: null, revenue: 0, optedOut: false, negative: false, source: "manual" as const };
    const m = exp.members.find((x) => x.customerId === id)!;
    const next: Outcome = { ...prev, ...patch, source: "manual" };
    if (patch.purchased !== undefined) next.revenue = patch.purchased ? m.typicalOrderValue : 0;
    onOutcomes(exp, { [id]: next }, `Manual outcome recorded for ${id} in ${exp.id}.`);
  };
  const exportCsv = () => {
    const header = ["experiment", "customer_id", "group", "action", "purchased", "revenue", "opted_out", "outcome_source"];
    const lines = exp.members.map((m) => {
      const o = exp.outcomes[m.customerId];
      return [exp.id, m.customerId, m.group, m.group === "control" ? "none" : m.action, o?.purchased === null || !o ? "pending" : o.purchased ? "yes" : "no", o?.revenue ?? 0, o?.optedOut ? "yes" : "no", o?.source ?? "pending"].map(csvSafe).join(",");
    });
    download(`${exp.id}-assignments.csv`, [header.join(","), ...lines].join("\n"));
  };
  return (
    <Disclosure flush title="Assignments and outcome records" hint={`${exp.members.length} customers · seed ${exp.seed}`}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={exportCsv} icon="download">Export CSV</Button>
        {!confirm ? (
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>Delete experiment</Button>
        ) : (
          <>
            <Button size="sm" variant="danger" onClick={onDelete}>Confirm delete</Button>
            <Button size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
          </>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-line"><th className={th}>Customer</th><th className={th}>Group</th><th className={th}>Action</th><th className={th}>Purchased?</th><th className={th}>Opted out</th><th className={th}>Source</th></tr></thead>
          <tbody>
            {rows.map((m) => {
              const o = exp.outcomes[m.customerId];
              const val = !o || o.purchased === null ? "pending" : o.purchased ? "yes" : "no";
              return (
                <tr key={m.customerId} className="border-b border-line last:border-0">
                  <td className={`${td} py-2 font-medium`}>{m.customerId}</td>
                  <td className={`${td} py-2`}>{m.group === "control" ? <Tag tone="outline">Did not receive</Tag> : <Tag tone="plum">Received</Tag>}</td>
                  <td className={`${td} py-2 text-ink-soft`}>{m.group === "control" ? "No contact" : ACTION_LABEL[m.action]}</td>
                  <td className={`${td} py-2`}>
                    <select aria-label={`Outcome ${m.customerId}`} className="h-8 rounded-md border border-line-strong px-1.5 text-sm" value={val} onChange={(e) => setOne(m.customerId, { purchased: e.target.value === "pending" ? null : e.target.value === "yes" })}>
                      <option value="pending">pending</option><option value="yes">yes</option><option value="no">no</option>
                    </select>
                  </td>
                  <td className={`${td} py-2`}><input type="checkbox" aria-label={`Opted out ${m.customerId}`} checked={!!o?.optedOut} onChange={(e) => setOne(m.customerId, { optedOut: e.target.checked, negative: e.target.checked })} /></td>
                  <td className={`${td} py-2`}>{o ? (o.source === "simulated" ? <SimulatedTag /> : <span className="text-ink-soft">{o.source}</span>) : <span className="text-ink-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-line"><Pager page={page} pages={Math.ceil(exp.members.length / PAGE)} onPage={setPage} total={exp.members.length} label="customers" /></div>
      </div>
    </Disclosure>
  );
}
