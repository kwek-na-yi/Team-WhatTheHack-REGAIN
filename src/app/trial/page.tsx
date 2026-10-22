"use client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AssumptionsForm, Slider } from "@/components/AssumptionsForm";
import { now, useApp, useQueryId } from "@/components/AppProvider";
import { CaseBar } from "@/components/CaseBar";
import { AXIS, CHART, tooltipBox } from "@/components/chartTheme";
import { Button, ButtonLink, Card, CustomerPicker, DataGate, DecisionBadge, Disclosure, DisclosureGroup, EmptyState, Notice, PageHeader, Source, td, TextLink, th, TipText, type Provenance } from "@/components/ui";
import { ACTION_SHORT, ACTION_VERB, certaintyText, DECISION_DEF, GLOSSARY, mainReason } from "@/lib/present";
import { ACTION_LABEL, baselineProbability, hasReplenishmentPattern, ordersIfReturn, runTrial, type TrialOverrides } from "@/lib/trial";
import type { Assumptions, CustomerProfile, Decision, ScenarioResult, TrialResult } from "@/lib/types";
import { fmtMoney, fmtPct, fmtPp } from "@/lib/utils";

export default function TrialPage() {
  return (
    <DataGate>
      <Inner />
    </DataGate>
  );
}

const DETAIL_ROWS: { label: string; fmt: (s: ScenarioResult) => string; strong?: boolean; group?: string }[] = [
  { group: "Chance of buying", label: "Without any action", fmt: (s) => fmtPct(s.baselineProb, 0) },
  { label: "With this action", fmt: (s) => fmtPct(s.actionProb, 1) },
  { label: "Assumed lift", fmt: (s) => fmtPp(s.upliftPp) },
  { group: "Revenue", label: "Orders if they return", fmt: (s) => s.ordersIfReturn.toFixed(2) },
  { label: "Expected orders", fmt: (s) => s.expectedOrders.toFixed(2) },
  { label: "Expected revenue", fmt: (s) => fmtMoney(s.expectedRevenue, 2) },
  { label: "Extra revenue vs doing nothing", fmt: (s) => fmtMoney(s.incrementalRevenue, 2) },
  { group: "Contribution and costs", label: "Contribution (revenue × margin)", fmt: (s) => fmtMoney(s.grossContribution, 2) },
  { label: "Message or staff cost", fmt: (s) => fmtMoney(s.contactCost, 2) },
  { label: "Benefit cost", fmt: (s) => fmtMoney(s.benefitCost, 2) },
  { label: "Discount cost (paid to likely buyers)", fmt: (s) => (s.discountCost ? `${fmtMoney(s.discountCost, 2)} (${fmtMoney(s.discountLeakage, 2)})` : "$0.00") },
  { label: "Opt-out risk cost", fmt: (s) => fmtMoney(s.experienceRiskCost, 2) },
  { label: "Total cost", fmt: (s) => fmtMoney(s.totalCost, 2) },
  { group: "Result", label: "Extra contribution", fmt: (s) => fmtMoney(s.incrementalContribution, 2), strong: true },
  { label: "Range", fmt: (s) => `${fmtMoney(s.incrementalLow, 2)} to ${fmtMoney(s.incrementalHigh, 2)}` },
];

const label = "text-2xs font-medium uppercase tracking-wider text-ink-faint";

function Fact({ name, children, tip }: { name: string; children: ReactNode; tip?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-faint">{tip ? <TipText text={tip}>{name}</TipText> : name}</div>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}

type PathStep = { label: string; lines: { text: string; source: Provenance }[]; highlight?: boolean };

/** Builds the visual reasoning path from the actual record and engine output only. */
function decisionPath(p: CustomerProfile, r: TrialResult): PathStep[] {
  const hasRhythm = p.rhythmSource !== "population";
  const usual = hasRhythm ? Math.round(p.medianInterval as number) : 0;
  const signal: PathStep["lines"] = hasRhythm
    ? [{ text: p.status === "on_rhythm" ? `Buying as usual — ${p.recencyDays} days since last purchase, usually ${usual}` : `${p.recencyDays} days since last purchase — usually ${usual} (${p.overdueRatio}× longer)`, source: "calculated" }]
    : [{ text: `Only ${p.orderCount} purchase — no personal buying pattern yet`, source: "observed" }];

  const evidence: PathStep["lines"] = [];
  if (r.suppression) evidence.push({ text: r.reasons[0], source: "observed" });
  evidence.push(p.openServiceIssue ? { text: `Recorded complaint: “${p.openServiceIssue.issue}” — unresolved`, source: "observed" } : { text: "No complaint on record", source: "observed" });
  if (hasReplenishmentPattern(p)) evidence.push({ text: `Regular ${p.topCategory} buyer (${Math.round(p.categoryShare * 100)}% of purchases)`, source: "calculated" });
  else if (hasRhythm && p.status !== "on_rhythm") evidence.push({ text: "No regular repeat pattern — the reason for the change is unclear", source: "calculated" });

  const chosen = r.scenarios.find((s) => s.action === r.recommendedAction) as ScenarioResult;
  const disc = r.scenarios.find((s) => s.action === "discount") as ScenarioResult;
  const best = r.scenarios.filter((s) => s.action !== "no_action" && s.eligible).sort((a, b) => b.incrementalContribution - a.incrementalContribution)[0];
  const trade: PathStep["lines"] = [];
  if (r.decision !== "HOLD") {
    trade.push({ text: `About ${fmtMoney(chosen.incrementalContribution, 2)} extra for ${fmtMoney(chosen.totalCost, 2)} cost`, source: "estimated" });
    if (r.recommendedAction !== "discount" && disc.eligible && disc.discountLeakage > 0) trade.push({ text: `A discount would pay ${fmtMoney(disc.discountLeakage, 2)} to likely buyers`, source: "estimated" });
  } else if (r.suppression) {
    trade.push({ text: "No contact, no cost — a rule blocks contact", source: "observed" });
  } else if (best) {
    trade.push({ text: `Best option adds only ${fmtMoney(best.incrementalContribution, 2)} — not worth acting on`, source: "estimated" });
  } else {
    trade.push({ text: "No cost — nothing to gain from contact now", source: "estimated" });
  }

  return [
    { label: "What changed", lines: signal },
    { label: "Evidence", lines: evidence },
    { label: "Decision", lines: [{ text: `${DECISION_DEF[r.decision].title}: ${ACTION_VERB[r.recommendedAction]}`, source: "calculated" }], highlight: true },
    { label: "Trade-off", lines: trade },
  ];
}

function Inner() {
  const { state, dispatch, analysis } = useApp();
  const qid = useQueryId();
  const [id, setId] = useState<string | null>(null);
  const [local, setLocal] = useState<Assumptions>(state.assumptions);
  const [ov, setOv] = useState<TrialOverrides>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const ok = (x?: string | null) => !!x && !!analysis.byId[x];
    const top = Object.values(analysis.trials).sort((a, b) => b.priorityScore - a.priorityScore)[0]?.customerId ?? null;
    const pick = ok(qid) ? qid : ok(state.selectedCustomerId) ? (state.selectedCustomerId as string) : top;
    setId(pick);
    if (pick && pick !== state.selectedCustomerId) dispatch({ type: "SELECT_CUSTOMER", customerId: pick });
  }, [qid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setLocal(state.assumptions), [state.assumptions]);

  const choose = (cid: string) => {
    setId(cid);
    setOv({});
    dispatch({ type: "SELECT_CUSTOMER", customerId: cid });
    window.history.replaceState(null, "", `/trial?id=${cid}`);
  };

  const p = id ? analysis.byId[id] : undefined;
  const result = useMemo(
    () => (p ? runTrial(p, { assumptions: local, interventions: state.interventions, asOf: state.asOf, overrides: ov, suppressedUntil: state.suppressedUntil }) : null),
    [p, local, ov, state.interventions, state.asOf, state.suppressedUntil],
  );
  const savedResult = id ? analysis.trials[id] : undefined;

  const header = <PageHeader title="Recovery Decisions" subtitle="What should we do for this customer — and is it worth it?" actions={<CustomerPicker value={id} onChange={choose} />} />;
  if (!p || !result)
    return (
      <>
        {header}
        <EmptyState title="Choose a customer to compare recovery actions" />
      </>
    );

  const dirty = JSON.stringify(local) !== JSON.stringify(state.assumptions) || Object.keys(ov).length > 0;
  const changed = savedResult && (savedResult.decision !== result.decision || savedResult.recommendedAction !== result.recommendedAction);
  const chosen = result.scenarios.find((s) => s.action === result.recommendedAction) as ScenarioResult;
  const contacts = result.scenarios.filter((s) => s.action !== "no_action");
  const hasRhythm = p.rhythmSource !== "population";
  // A rule-based hold (consent, opt-out, contact limit) is not an estimate.
  const certainty = result.suppression ? { label: "Certain — a rule applies", line: "This follows a consent or contact rule, not an estimate." } : certaintyText(p);
  const rejectedReason = (a: string) => result.rejected.find((r) => r.action === a)?.reason ?? "";
  const path = decisionPath(p, result);
  const isHold = result.decision === "HOLD";
  const chartData = result.scenarios.map((s) => ({
    name: ACTION_SHORT[s.action],
    action: s.action,
    value: Number(s.incrementalContribution.toFixed(2)),
    // Recharts skips null; a zero-width range would otherwise render duplicate-keyed lines.
    err: s.incrementalHigh - s.incrementalLow < 0.005 ? null : [Number((s.incrementalContribution - s.incrementalLow).toFixed(2)), Number((s.incrementalHigh - s.incrementalContribution).toFixed(2))],
    eligible: s.eligible,
  }));
  const p0Default = baselineProbability(p, local);
  const nDefault = ordersIfReturn(p, local);

  return (
    <>
      {header}
      <CaseBar customerId={p.customerId} />

      {/* Customer context — a plain row, not another card */}
      <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <Fact name="Customer"><TextLink href={`/customers/${p.customerId}`}>{p.customerId}</TextLink></Fact>
        <Fact name="Purchase history">{p.orderCount} purchase{p.orderCount === 1 ? "" : "s"} since {p.firstOrderDate.slice(0, 7)}</Fact>
        <Fact name="What changed" tip={GLOSSARY.vsRhythm}>{hasRhythm ? `${p.recencyDays} days since last purchase · usually ${Math.round(p.medianInterval as number)}` : `Last purchase ${p.recencyDays} days ago`}</Fact>
        <Fact name="Complaint on record">{p.openServiceIssue ? <span className="text-crimson-text">{p.openServiceIssue.issue}</span> : "None"}</Fact>
        <Fact name="Evidence" tip={GLOSSARY.evidence}>{p.orderCount >= 3 ? certaintyText(p).label : "Too little history"}</Fact>
      </div>

      {dirty && (
        <div className="mb-4">
          <Notice tone="info">
            <b className="font-medium text-ink">What-if mode</b> — you&apos;re viewing changed estimates.{changed && savedResult ? ` The recommendation changed from “${ACTION_SHORT[savedResult.recommendedAction]}” to “${ACTION_SHORT[result.recommendedAction]}”.` : " The recommendation is unchanged."}
          </Notice>
        </div>
      )}

      {/* Recommendation — emphasis through layout and one plum rule */}
      <section aria-labelledby="rec-title" className="rounded-lg border border-line border-l-2 border-l-plum-accent bg-surface">
        <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="flex items-center gap-3"><span className={label}>Recommended action</span><DecisionBadge d={result.decision} /></div>
            <h2 id="rec-title" className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-ink">{ACTION_VERB[result.recommendedAction]}</h2>
            <div className={`mt-5 ${label}`}>Why?</div>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{mainReason(result)}</p>
          </div>
          <div className="min-w-0">
            <div className={label}>Estimated value</div>
            {!isHold ? (
              <>
                <div className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${chosen.incrementalContribution < 0 ? "text-crimson-text" : "text-ink"}`}>{fmtMoney(chosen.incrementalContribution, 2)}</div>
                <div className="mt-1 text-sm text-ink-muted"><TipText text={GLOSSARY.extraContribution}>extra contribution</TipText>, next 90 days</div>
                <div className="mt-3 text-sm text-ink-soft">Range {fmtMoney(chosen.incrementalLow, 2)} to {fmtMoney(chosen.incrementalHigh, 2)}</div>
                <div className="text-sm text-ink-soft">Costs {fmtMoney(chosen.totalCost, 2)}</div>
                <div className="mt-2"><Source kind="estimated" /></div>
              </>
            ) : (
              <>
                <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-ink">$0.00</div>
                <div className="mt-1 text-sm text-ink-muted">No contact, no discount, no cost.</div>
              </>
            )}
          </div>
          <div className="min-w-0 space-y-6">
            <div>
              <div className={label}>How certain are we?</div>
              <div className="mt-2 text-sm font-medium text-ink">{p.orderCount >= 3 || result.suppression ? certainty.label : "Too little history"}</div>
              <p className="mt-0.5 text-sm text-ink-muted">{certainty.line}</p>
              {!isHold && <div className="mt-1.5"><Source kind="unvalidated" /></div>}
            </div>
            <div>
              <div className={label}>What next?</div>
              <div className="mt-2">
                {!isHold ? (
                  <ButtonLink href={`/studio?id=${p.customerId}`} variant="primary">Review message</ButtonLink>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-soft">{result.suppression ? "Contact is blocked by a consent or frequency rule." : "Nothing to send."}</p>
                    <ButtonLink href={`/customers/${p.customerId}`} size="sm">View customer</ButtonLink>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* How REGAIN reached the decision */}
        <ol className="grid border-t border-line md:grid-cols-4" aria-label="How REGAIN reached this decision">
          {path.map((s, i) => (
            <li key={s.label} className={`p-5 ${i > 0 ? "border-t border-line md:border-l md:border-t-0" : ""}`}>
              <div className={label}>{i + 1} · {s.label}</div>
              <ul className="mt-2 space-y-2.5">
                {s.lines.map((l, k) => (
                  <li key={k} className={`text-sm ${s.highlight ? "font-medium text-ink" : "text-ink-soft"}`}>
                    {l.text}
                    <span className="mt-0.5 block"><Source kind={l.source} /></span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      {/* The three possible outcomes — plain text, the selected one marked */}
      <div className="mt-4 grid gap-4 px-1 sm:grid-cols-3" role="list" aria-label="Possible decision outcomes">
        {(["RECOVER", "UNDERSTAND", "HOLD"] as Decision[]).map((d) => {
          const on = d === result.decision;
          return (
            <div key={d} role="listitem" aria-current={on ? "true" : undefined} className={`border-t pt-2 text-xs ${on ? "border-plum-accent" : "border-line"}`}>
              <div className={on ? "font-medium text-ink" : "text-ink-faint"}>{DECISION_DEF[d].title}{on && <span className="ml-1.5 text-ink-faint">· selected</span>}</div>
              <div className="mt-0.5 text-ink-faint">{DECISION_DEF[d].line}</div>
            </div>
          );
        })}
      </div>


      <DisclosureGroup className="mt-7">
        <Disclosure flush title="Compare alternative actions" hint="Outreach, service recovery, incentives and doing nothing">
          <p className="mb-3 text-sm text-ink-muted">Each option compared with doing nothing, over the next 90 days. Hover over or tap the ⓘ next to a verdict to see why.</p>
          <div className="-mx-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr>
                  <th className={th}>Action</th>
                  <th className={`${th} text-right`}><TipText text={GLOSSARY.extraContribution}>Est. extra contribution</TipText></th>
                  <th className={`${th} text-right`}><TipText text={GLOSSARY.cost}>Cost</TipText></th>
                  <th className={th}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {[result.scenarios.find((s) => s.action === "no_action") as ScenarioResult, ...contacts].map((s) => {
                  const rec = s.action === result.recommendedAction;
                  const loses = s.eligible && s.action !== "no_action" && s.incrementalContribution < 0;
                  return (
                    <tr key={s.action} className={`border-t border-line ${rec ? "bg-plum" : ""}`}>
                      <td className={`${td} ${s.eligible ? "text-ink" : "text-ink-faint"} ${rec ? "font-medium" : ""}`}>{ACTION_LABEL[s.action]}</td>
                      <td className={`${td} text-right tabular-nums ${!s.eligible ? "text-ink-faint" : loses ? "text-crimson-text" : "text-ink-soft"}`}>{s.action === "no_action" ? "$0.00" : !s.eligible ? "—" : fmtMoney(s.incrementalContribution, 2)}</td>
                      <td className={`${td} text-right tabular-nums text-ink-faint`}>{!s.eligible ? "—" : fmtMoney(s.totalCost, 2)}</td>
                      <td className={`${td} text-sm`}>
                        {rec ? (
                          <span className="font-medium text-ink">Recommended</span>
                        ) : (
                          <span className={!s.eligible ? "text-ink-faint" : loses ? "text-crimson-text" : "text-ink-muted"}>
                            <TipText text={rejectedReason(s.action)}>{!s.eligible ? "Not allowed" : s.action === "no_action" ? "Starting point" : loses ? "Loses money" : isHold ? "Not worth it" : "Lower value"}</TipText>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
          <div className="mt-6">
          <div className="mb-1 flex items-baseline gap-3 text-sm font-medium text-ink">Estimated extra contribution by action <Source kind="estimated" /></div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                <ReferenceLine y={0} stroke={CHART.ref} />
                <ReferenceLine y={local.minIncrementalContribution} stroke={CHART.ref} strokeDasharray="4 3" label={{ value: "minimum worth acting on", fontSize: 11, fill: CHART.axis, position: "insideTopLeft" }} />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as (typeof chartData)[number] | undefined;
                    if (!d) return null;
                    const s = result.scenarios.find((x) => x.action === d.action) as ScenarioResult;
                    return (
                      <div className={tooltipBox}>
                        <div className="font-medium">{s.label}{!s.eligible && " (not allowed)"}</div>
                        <div>Expected {fmtMoney(s.incrementalContribution, 2)}</div>
                        <div className="text-ink-muted">Range {fmtMoney(s.incrementalLow, 2)} to {fmtMoney(s.incrementalHigh, 2)}</div>
                      </div>
                    );
                  }}
                />
                <Bar isAnimationActive={false} dataKey="value" radius={[3, 3, 3, 3]} maxBarSize={44}>
                  {chartData.map((d) => <Cell key={d.action} fill={!d.eligible ? CHART.faint : d.value < 0 ? CHART.risk : d.action === result.recommendedAction ? CHART.primary : CHART.neutral} />)}
                  <ErrorBar dataKey="err" width={6} stroke={CHART.whisker} strokeWidth={1.25} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-ink-faint">Plum = recommended · grey = other options · crimson = loses money · palest = not allowed. Whiskers show the result if the true lift is {Math.round(result.uncertaintyBand * 100)}% lower or higher.</p>

          </div>
        </Disclosure>

        <Disclosure flush title="Adjust the estimates" hint={dirty ? "Changed estimates" : "Sliders and full calculation"}>
          <p className="mb-5 text-sm text-ink-muted">Every number below is an estimate you can change. The recommendation above updates instantly.</p>
          <div className={`mb-4 ${label}`}>This customer only</div>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
              <Slider label="Chance of buying without action" value={ov.baselineProb ?? p0Default} min={0} max={0.95} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => setOv((o) => ({ ...o, baselineProb: v }))} hint={`Default ${fmtPct(p0Default)}`} />
              <Slider label="Typical order value" value={ov.typicalOrderValue ?? p.typicalOrderValue} min={5} max={250} step={1} fmt={(v) => fmtMoney(v)} onChange={(v) => setOv((o) => ({ ...o, typicalOrderValue: v }))} hint={`Observed ${fmtMoney(p.typicalOrderValue, 2)}`} />
              <Slider label="Orders if they return" value={ov.ordersIfReturn ?? nDefault} min={1} max={3} step={0.1} fmt={(v) => v.toFixed(1)} onChange={(v) => setOv((o) => ({ ...o, ordersIfReturn: v }))} hint={`Calculated ${nDefault}`} />
          </div>

          <div className="mt-7 border-t border-line pt-5">
            <div className={`mb-4 ${label}`}>Estimates used for every customer</div>
            <AssumptionsForm value={local} onChange={setLocal} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={JSON.stringify(local) === JSON.stringify(state.assumptions)}
              onClick={() => {
                dispatch({ type: "SET_ASSUMPTIONS", assumptions: local, note: `Business assumptions updated from Recovery Decisions (customer ${p.customerId}).`, at: now() });
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
              }}
            >
              Save estimates for all customers
            </Button>
            <Button disabled={!dirty} onClick={() => { setLocal(state.assumptions); setOv({}); }}>Discard what-if</Button>
            <span className="text-xs text-ink-faint">“This customer only” changes are never saved.</span>
          </div>
          {saved && <div className="mt-3"><Notice tone="success">Saved. Every customer&apos;s recommendation was recalculated and the change logged.</Notice></div>}

          <div className="mt-7 overflow-x-auto border-t border-line pt-5">
            <div className="mb-2 flex items-baseline gap-3 text-sm font-medium text-ink">Full calculation <Source kind="estimated" /></div>
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  <th className={th}>Per customer, 90 days</th>
                  {result.scenarios.map((s) => <th key={s.action} className={`${th} text-right ${s.action === result.recommendedAction ? "text-ink" : ""}`}>{ACTION_SHORT[s.action]}</th>)}
                </tr>
              </thead>
              <tbody>
                {DETAIL_ROWS.map((r) => (
                  <Fragment key={r.label}>
                    {r.group && <tr><td colSpan={7} className="px-5 pb-1 pt-4 text-xs font-medium text-ink-faint">{r.group}</td></tr>}
                    <tr className="border-t border-line">
                      <td className={`px-5 py-1.5 ${r.strong ? "font-medium text-ink" : "text-ink-muted"}`}>{r.label}</td>
                      {result.scenarios.map((s) => (
                        <td key={s.action} className={`px-5 py-1.5 text-right tabular-nums ${r.strong ? "font-medium" : ""} ${!s.eligible ? "text-ink-faint" : "text-ink-soft"} ${s.action === result.recommendedAction ? "bg-plum text-ink" : ""}`}>{r.fmt(s)}</td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
            <div className="mt-3 space-y-0.5 text-xs text-ink-faint">
              {result.scenarios.flatMap((s) => s.notes.map((n, i) => <div key={s.action + i}>{ACTION_SHORT[s.action]}: {n}</div>))}
            </div>
          </div>
        </Disclosure>

        <Disclosure flush title="See why — full reasoning">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-soft">{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="mt-5 text-sm font-medium text-ink">Why not the other actions?</div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {result.rejected.map((r) => <li key={r.action} className="text-ink-soft"><span className="text-ink">{ACTION_LABEL[r.action]}:</span> {r.reason}</li>)}
          </ul>
        </Disclosure>

        <Disclosure flush title="Customer records used" hint={`${p.evidence.filter((e) => e.kind === "fact" || e.kind === "indicator").length} items`}>
          <ul className="space-y-2 text-sm text-ink-soft">
            {p.evidence.filter((e) => e.kind === "fact" || e.kind === "indicator").map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3">{e.text} <Source kind={e.kind === "fact" ? "observed" : "calculated"} /></li>
            ))}
          </ul>
          <div className="mt-4"><TextLink href={`/customers/${p.customerId}`}>Full customer profile</TextLink></div>
        </Disclosure>

        <Disclosure flush title="How certain are we?" hint={`Lift could be ±${Math.round(result.uncertaintyBand * 100)}% off`}>
          <p className="text-sm text-ink-soft">The range assumes the action&apos;s real effect could be {Math.round(result.uncertaintyBand * 100)}% lower or higher than estimated: ±50% with a strong history, ±75% with some, ±100% with little, plus 25% if there&apos;s no personal buying pattern.</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-soft">{result.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </Disclosure>

        <Disclosure flush title="How it's calculated">
          <div className="grid gap-6 md:grid-cols-2">
            <pre className="whitespace-pre-wrap rounded-md bg-canvas p-4 font-mono text-xs leading-relaxed text-ink-soft">{`p0  = chance of buying without action (by status)
u   = estimated lift × status and evidence adjustments
p_a = min(0.95, p0 + u)
N   = clamp(horizon ÷ usual gap, 1, 3)

Revenue      = p_a × N × order value
Contribution = Revenue × margin
Cost         = message/staff + p_a × benefit
             + p_a × discount × order value
             + opt-out risk × opt-out loss
Extra contribution
             = Contribution − Cost
               − (p0 × N × order value × margin)`}</pre>
            <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
              <li><span className="text-ink">Contribution, not revenue.</span> Decisions use margin after the action&apos;s cost.</li>
              <li><span className="text-ink">Discount leakage.</span> Discounts are also paid to customers who would have bought anyway.</li>
              <li><span className="text-ink">Rules first.</span> Opt-outs, missing consent and contact limits block contact before any numbers are considered.</li>
              <li><span className="text-ink">Estimates, not proof.</span> Only a holdout test in Impact &amp; Experiments can show whether an action really works.</li>
            </ul>
          </div>
        </Disclosure>
      </DisclosureGroup>
    </>
  );
}
