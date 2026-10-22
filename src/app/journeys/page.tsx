"use client";
// Engagement & Journey: a read-only monitor of recovery journeys, derived from existing records
// (see lib/journey.ts). Nothing on this page sends, schedules or changes a contact; selecting a
// customer only sets the active case shared with the other pages.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Button, ButtonLink, Card, DataGate, DecisionBadge, EmptyState, Icon, InfoTip, Notice, PageHeader, Pager, selectCls, Source, Stat, StatGroup, Tag, td, TextLink, th, trHover } from "@/components/ui";
import { latestContribution } from "@/lib/insights";
import {
  buildCustomerJourneys,
  buildJourneys,
  EVENT_LABEL,
  filterCustomers,
  journeyFunnel,
  journeyKpis,
  NO_FILTERS,
  OUTCOME_WINDOW_DAYS,
  outcomeAnalysis,
  PURCHASE_LABEL,
  sortCustomers,
  sortJourneys,
  SOURCE_DEF,
  SOURCE_LABEL,
  STAGES,
  type CustomerJourney,
  type CustomerSort,
  type EventSource,
  type EventType,
  type Journey,
  type JourneyEvent,
  type JourneyFilters,
  type JourneySort,
  type JourneyStatus,
  type PurchaseStatus,
  type StageKey,
} from "@/lib/journey";
import { ACTION_SHORT } from "@/lib/present";
import { ACTION_LABEL } from "@/lib/trial";
import type { ActionId } from "@/lib/types";
import { fmtMoney, fmtPct, fmtPp } from "@/lib/utils";

const J_PAGE = 8;
// Compact cells for the two dense tables, so they fit a laptop screen without sideways scrolling.
const thc = th.replace("px-5", "px-3");
const tdc = td.replace("px-5", "px-3");
const C_PAGE = 10;
const STATUSES: JourneyStatus[] = ["Active", "Monitoring", "Blocked", "No follow-up needed", "Finished (imported)", "In progress (imported)", "Waiting for results", "Results in"];
const ACTIONS: ActionId[] = ["reminder", "service_recovery", "check_in", "benefit", "discount"];
const EVENT_TYPES: EventType[] = ["contact", "approved", "rejected", "drafted", "response", "opt_out", "suppressed", "experiment", "outcome", "holdout", "purchase"];
const OUTCOMES: PurchaseStatus[] = ["purchased", "no_purchase", "window_open", "no_contact"];
const SOURCE_CLS: Record<EventSource, string> = {
  observed: "text-ink-faint",
  recorded: "text-info",
  simulated: "rounded border border-dashed border-plum-accent px-1 text-plum-text",
  calculated: "text-ink-faint",
};

export default function JourneysPage() {
  return (
    <DataGate>
      <Inner />
    </DataGate>
  );
}

function SourceBadge({ s }: { s: EventSource }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className={`text-2xs font-medium uppercase tracking-wider ${SOURCE_CLS[s]}`}>{SOURCE_LABEL[s]}</span>
      <InfoTip text={SOURCE_DEF[s]} label={`What does “${SOURCE_LABEL[s]}” mean?`} />
    </span>
  );
}

function when(e: JourneyEvent | null): string {
  if (!e) return "—";
  if (e.date) return e.date;
  if (e.at) return `Recorded ${new Date(e.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  return "Time not recorded";
}

function Inner() {
  const { state, analysis, dispatch } = useApp();
  const [f, setF] = useState<JourneyFilters>(NO_FILTERS);
  const [jSort, setJSort] = useState<JourneySort>("customers");
  const [cSort, setCSort] = useState<CustomerSort>("attention");
  const [jPage, setJPage] = useState(0);
  const [cPage, setCPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const src = useMemo(
    () => ({ analysis, interventions: state.interventions, conversations: state.conversations, experiments: state.experiments, audit: state.audit, asOf: state.asOf }),
    [analysis, state.interventions, state.conversations, state.experiments, state.audit, state.asOf],
  );
  const all = useMemo(() => buildCustomerJourneys(src), [src]);
  const allJourneys = useMemo(() => buildJourneys(all, src), [all, src]);
  const filtered = useMemo(() => filterCustomers(all, allJourneys, f, state.asOf), [all, allJourneys, f, state.asOf]);
  const journeys = useMemo(() => {
    const js = buildJourneys(filtered, src).filter((j) => (f.status === "all" || j.status === f.status) && (f.journey === "all" || j.id === f.journey));
    return sortJourneys(js, jSort, state.asOf);
  }, [filtered, src, f.status, f.journey, jSort, state.asOf]);
  const rows = useMemo(() => sortCustomers(filtered, cSort, state.asOf), [filtered, cSort, state.asOf]);
  const kpi = useMemo(() => journeyKpis(filtered), [filtered]);
  const funnel = useMemo(() => journeyFunnel(filtered), [filtered]);
  const outcome = useMemo(() => outcomeAnalysis(filtered), [filtered]);
  const contribution = useMemo(() => latestContribution(state.experiments, state.interventions), [state.experiments, state.interventions]);

  useEffect(() => {
    setJPage(0);
    setCPage(0);
  }, [f, jSort, cSort]);
  // Default timeline: the active case, else the furthest-progressed customer in view.
  useEffect(() => {
    if (selected && rows.some((r) => r.customerId === selected)) return;
    const active = state.selectedCustomerId && rows.find((r) => r.customerId === state.selectedCustomerId);
    setSelected(active ? active.customerId : (rows[0]?.customerId ?? null));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof JourneyFilters>(k: K, v: JourneyFilters[K]) => setF((x) => ({ ...x, [k]: v }));
  const filtersOn = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  const choose = (id: string) => {
    setSelected(id);
    dispatch({ type: "SELECT_CUSTOMER", customerId: id });
    document.getElementById("timeline")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const sel = selected ? all.find((c) => c.customerId === selected) ?? null : null;
  const jPages = Math.ceil(journeys.length / J_PAGE);
  const cPages = Math.ceil(rows.length / C_PAGE);
  const journeyName = (id: string) => allJourneys.find((j) => j.id === id)?.name ?? id;

  return (
    <>
      <PageHeader
        title="Engagement & Journey"
        subtitle="Who you've followed up with, how they replied, and whether they bought again."
        actions={
          <>
            {state.dataSource === "sample" && <Tag tone="plum" title="Fictional customers generated for the demo.">Demo mode · Synthetic data</Tag>}
            <span className="text-xs text-ink-muted">Data as of {state.asOf}</span>
          </>
        }
      />
      {/* Filters */}
      <Card className="mt-5" padded={false}>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" role="search" aria-label="Journey filters">
          <label className="relative">
            <span className="sr-only">Search customer ID or journey name</span>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-muted" />
            <input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Customer ID or journey" aria-label="Search customer ID or journey name" className="h-9 w-52 rounded-md border border-line-strong bg-surface pl-8 pr-2 text-sm text-ink placeholder:text-ink-faint" />
          </label>
          <select aria-label="Activity date range" value={f.range} onChange={(e) => set("range", e.target.value as JourneyFilters["range"])} className={selectCls}>
            <option value="all">Any time</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </select>
          <select aria-label="Journey status" value={f.status} onChange={(e) => set("status", e.target.value as JourneyFilters["status"])} className={selectCls}>
            <option value="all">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Recovery action" value={f.action} onChange={(e) => set("action", e.target.value as JourneyFilters["action"])} className={selectCls}>
            <option value="all">Any action</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
          </select>
          <select aria-label="Event type" value={f.eventType} onChange={(e) => set("eventType", e.target.value as JourneyFilters["eventType"])} className={selectCls}>
            <option value="all">Any event</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}
          </select>
          <select aria-label="Outcome" value={f.outcome} onChange={(e) => set("outcome", e.target.value as JourneyFilters["outcome"])} className={selectCls}>
            <option value="all">Any result</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{PURCHASE_LABEL[o]}</option>)}
          </select>
          <select aria-label="Data mode" value={f.mode} onChange={(e) => set("mode", e.target.value as JourneyFilters["mode"])} className={selectCls}>
            <option value="all">Real and simulated</option>
            <option value="observed">Real records only</option>
            <option value="simulated">Simulated only</option>
          </select>
          <Button size="sm" variant="ghost" onClick={() => setF(NO_FILTERS)} disabled={!filtersOn}>Clear filters</Button>
        </div>
        {(f.stage !== "all" || f.journey !== "all") && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 text-xs text-ink-soft">
            {f.stage !== "all" && <span className="inline-flex items-center gap-1 rounded bg-plum px-2 py-0.5 text-plum-text">Step:{STAGES.find((s) => s.key === f.stage)?.label}<button type="button" aria-label="Clear stage filter" onClick={() => set("stage", "all")}><Icon name="x" className="h-3 w-3" /></button></span>}
            {f.journey !== "all" && <span className="inline-flex items-center gap-1 rounded bg-plum px-2 py-0.5 text-plum-text">Journey: {journeyName(f.journey)}<button type="button" aria-label="Clear journey filter" onClick={() => set("journey", "all")}><Icon name="x" className="h-3 w-3" /></button></span>}
          </div>
        )}
      </Card>

      {/* KPIs — every card counts unique customers */}
      <div className="mt-5">
        <StatGroup cols={5}>
          <Stat label="Contacted" value={kpi.contacted.customers} hint={`${kpi.contacted.simulated} by REGAIN (simulated) · ${kpi.contacted.observed} from imported records`} tip={`Customers messaged at least once, out of ${kpi.inView} shown. Each customer counts once (${kpi.contacted.records} messages in total).`} />
          <Stat label="Replied" value={kpi.responded.customers} hint={`Out of ${kpi.responded.ofContacted} contacted`} tip={`${kpi.responded.simulated} simulated replies and ${kpi.responded.observed} unsubscribes from imported records. No reply doesn't mean they ignored it.`} />
          <Stat label={`Bought again within ${OUTCOME_WINDOW_DAYS} days`} value={kpi.purchased.rate === null ? "—" : fmtPct(kpi.purchased.rate, 1)} hint={kpi.purchased.rate === null ? "Too early to tell" : `${kpi.purchased.customers} of ${kpi.purchased.eligible} customers`} tip={`Of contacted customers, how many bought within ${OUTCOME_WINDOW_DAYS} days of their last message. ${kpi.purchased.windowOpen} contacted too recently to tell are left out. Buying after a message doesn't prove the message caused it.`} />
          <Stat label="Need your review" value={kpi.needsReview} hint="Messages or replies to check" tip="Customers where a person should look at something next — see “What to do next” below." />
          <Stat label="Can't be contacted" value={kpi.blocked} hint="No consent, unsubscribed or messaged recently" tip="These rules can't be overridden from this page." />
        </StatGroup>
      </div>

      {/* Funnel */}
      <Card className="mt-6" title="Steps" subtitle="How many customers reached each step. Click a step to see who.">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label="Journey stages">
          {funnel.map((s, i) => {
            const on = f.stage === s.key;
            return (
              <li key={s.key} className="relative">
                <button
                  type="button"
                  onClick={() => set("stage", on ? "all" : s.key)}
                  aria-pressed={on}
                  data-stage={s.key}
                  className={`flex h-full w-full flex-col rounded-md border px-3 py-2.5 text-left transition-colors ${on ? "border-brand bg-plum" : "border-line bg-surface hover:border-plum-accent"}`}
                >
                  <span className="text-2xs font-medium uppercase tracking-wider text-ink-faint">{i + 1} · {s.label}</span>
                  <span className="mt-1 text-2xl font-semibold tabular-nums text-ink" data-count>{s.customers}</span>
                  <span className="text-xs text-ink-muted">{s.shareOfPrevious !== null ? `${fmtPct(s.shareOfPrevious)} of step ${i}` : "customers"}</span>
                </button>
                <span className="absolute right-2 top-2"><InfoTip text={`${s.help}${s.note ? ` ${s.note}` : ""}`} label={`What does “${s.label}” mean?`} /></span>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* Journey list */}
      <Card
        className="mt-6"
        padded={false}
        title="Journeys"
        subtitle="Customers grouped by the kind of follow-up they're getting."
        right={
          <select aria-label="Sort journeys" value={jSort} onChange={(e) => setJSort(e.target.value as JourneySort)} className={selectCls}>
            <option value="customers">Sort: type, then size</option>
            <option value="activity">Sort: latest activity</option>
            <option value="name">Sort: name</option>
          </select>
        }
      >
        {journeys.length === 0 ? (
          <div className="p-5"><EmptyState title="No journeys match">Clear the filters to see everything.</EmptyState></div>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm" aria-label="Journeys">
                <thead>
                  <tr className="border-y border-line">
                    <th className={thc}>Journey</th>
                    <th className={thc}>Who's in it</th>
                    <th className={`${thc} text-right`}>Customers</th>
                    <th className={thc}>Status</th>
                    <th className={thc}>Latest activity</th>
                    <th className={thc}>Contacted · replied</th>
                    <th className={thc}>Bought again</th>
                    <th className={thc}><span className="sr-only">Show customers</span></th>
                  </tr>
                </thead>
                <tbody>
                  {journeys.slice(jPage * J_PAGE, jPage * J_PAGE + J_PAGE).map((j) => (
                    <JourneyRow key={j.id} j={j} onInspect={() => setF((x) => ({ ...x, journey: x.journey === j.id ? "all" : j.id }))} inspecting={f.journey === j.id} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line"><Pager page={jPage} pages={jPages} onPage={setJPage} total={journeys.length} label="journeys" /></div>
          </>
        )}
      </Card>

      {/* Customer activity */}
      <Card
        className="mt-6"
        padded={false}
        title="Customers"
        subtitle="Where each customer is, and what to do next."
        right={
          <select aria-label="Sort customers" value={cSort} onChange={(e) => setCSort(e.target.value as CustomerSort)} className={selectCls}>
            <option value="attention">Sort: needs review first</option>
            <option value="progress">Sort: furthest step</option>
            <option value="activity">Sort: latest activity</option>
            <option value="id">Sort: customer ID</option>
          </select>
        }
      >
        {rows.length === 0 ? (
          <div className="p-5"><EmptyState title="No customers match">Clear the filters to see everything.</EmptyState></div>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm" aria-label="Customer activity">
                <thead>
                  <tr className="border-y border-line">
                    <th className={thc}>Customer</th>
                    <th className={thc}>Decision</th>
                    <th className={thc}>Suggested action</th>
                    <th className={thc}>Step reached</th>
                    <th className={thc}>Latest activity</th>
                    <th className={thc}>Reply / result</th>
                    <th className={thc}>Can contact?</th>
                    <th className={thc}>What to do next</th>
                    <th className={thc}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(cPage * C_PAGE, cPage * C_PAGE + C_PAGE).map((c) => (
                    <tr key={c.customerId} className={`${trHover} ${selected === c.customerId ? "bg-plum" : ""}`} data-customer={c.customerId}>
                      <td className={`${tdc} font-semibold text-ink`}>{c.customerId}</td>
                      <td className={tdc}><DecisionBadge d={c.decision} /></td>
                      <td className={`${tdc} text-ink-soft`}>{ACTION_SHORT[c.recommendedAction]}</td>
                      <td className={`${tdc} text-ink-soft`} data-stage-reached={c.stage ?? "none"}>{c.stage ? STAGES.find((s) => s.key === c.stage)?.label : "—"}</td>
                      <td className={`${tdc} text-ink-soft`}>
                        <div>{when(c.lastActivity)}</div>
                        {c.lastActivity && <div className="text-xs text-ink-muted">{EVENT_LABEL[c.lastActivity.type]}</div>}
                      </td>
                      <td className={`${tdc} text-ink-soft`}>
                        {c.response ? <div>{c.response.label}</div> : null}
                        <div className={`text-xs ${c.purchase.status === "purchased" ? "text-good" : "text-ink-muted"}`}>{PURCHASE_LABEL[c.purchase.status]}{c.purchase.status === "purchased" ? ` (${c.purchase.purchaseDate})` : ""}</div>
                        {c.experimentOutcome?.source === "simulated" && <div className="text-xs text-plum-text">Test result simulated</div>}
                      </td>
                      <td className={tdc} data-contact={c.contact.allowed ? "allowed" : "blocked"}>{c.contact.allowed ? <span className="text-ink-soft">Yes</span> : <Tag tone="red">{c.contact.label}</Tag>}</td>
                      <td className={`${tdc} min-w-[220px] text-ink-soft`} data-next={c.next.kind}>{c.next.href ? <Link href={c.next.href} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink-muted">{c.next.text}</Link> : c.next.text}</td>
                      <td className={`${tdc} whitespace-nowrap text-right`}>
                        <span className="inline-flex gap-1.5">
                          <Button size="sm" onClick={() => choose(c.customerId)}>Timeline</Button>
                          <ButtonLink size="sm" href={`/insights?id=${c.customerId}`}>View</ButtonLink>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line"><Pager page={cPage} pages={cPages} onPage={setCPage} total={rows.length} label="customers" /></div>
          </>
        )}
      </Card>

      {/* Timeline */}
      <div id="timeline" className="scroll-mt-20">
        <Card className="mt-6" title={sel ? `Timeline · ${sel.customerId}` : "Timeline"} subtitle="Everything recorded for this customer, oldest first.">
          {!sel ? (
            <EmptyState title="Pick a customer">Click “Timeline” on a customer above.</EmptyState>
          ) : (
            <Timeline c={sel} journeyName={journeyName} />
          )}
        </Card>
      </div>

      {/* Outcomes */}
      <Card className="mt-6" title="Did they buy again?" subtitle={`What happened in the ${OUTCOME_WINDOW_DAYS} days after each customer's last message.`}>
        <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
          <Metric name={`Bought within ${OUTCOME_WINDOW_DAYS} days`} kind="observed" value={outcome.rate === null ? "Too early to tell" : `${fmtPct(outcome.rate, 1)} (${outcome.purchased} of ${outcome.eligible})`} def={`${outcome.windowOpen} contacted too recently to tell are left out.`} tip={`Imported contacts: ${outcome.bySource.observed.purchased} of ${outcome.bySource.observed.eligible} bought. REGAIN's simulated messages: ${outcome.bySource.simulated.windowOpen} too recent to tell — a simulated message is dated the last day of your data, so there are no later purchases yet.`} />
          <Metric name="Typical time to buy" kind="observed" value={outcome.medianDaysToPurchase === null ? "—" : `${outcome.medianDaysToPurchase} days`} def="From the message to their next order (median)." />
          <Metric name="Average order" kind="observed" value={outcome.avgQualifyingOrder === null ? "—" : fmtMoney(outcome.avgQualifyingOrder, 2)} def="Their first order after the message." />
          <Metric name="Unsubscribed" kind="observed" value={outcome.optOut.rate === null ? "—" : `${fmtPct(outcome.optOut.rate, 1)} (${outcome.optOut.customers} of ${outcome.optOut.ofContacted})`} def="After a message in your imported records." tip={`Simulated “not interested” replies are counted separately: ${outcome.simulatedNotInterested}.`} />
          {contribution.kind === "experiment" ? (
            <Metric name="Did the message cause it?" kind={contribution.simulated ? "simulated" : "calculated"} value={`${fmtMoney(contribution.value, 2)} extra${contribution.simulated ? " (simulated)" : ""}`} def="Messaged vs not-messaged customers, after costs." tip={`From Impact & Experiments (${contribution.title}). Difference ${fmtPp(contribution.diffPp)}, likely range ${fmtPp(contribution.ci[0])} to ${fmtPp(contribution.ci[1])}.`} />
          ) : contribution.kind === "imported" ? (
            <Metric name="Did the message cause it?" kind="unvalidated" value={contribution.ci[0] <= 0 && contribution.ci[1] >= 0 ? "Not proven" : fmtPp(contribution.diffPp)} def={`Messaged customers bought ${fmtPp(contribution.diffPp)} more often, but that could be chance.`} tip={`From Impact & Experiments for “${contribution.title}”: likely range ${fmtPp(contribution.ci[0])} to ${fmtPp(contribution.ci[1])}, which includes zero.`} />
          ) : (
            <Metric name="Did the message cause it?" kind="unvalidated" value="—" def="Needs a test with a not-messaged group." />
          )}
          <Metric name="Expected value of current suggestions" kind="estimated" value={fmtMoney(analysis.expectedIncremental)} def={`An estimate for the next ${state.assumptions.horizonDays} days — not money earned.`} />
        </dl>
        <div className="mt-4">
          <Notice tone="info">Buying after a message doesn&apos;t prove the message worked — some would have bought anyway. <TextLink href="/impact">Impact &amp; Experiments</TextLink> tests that properly.</Notice>
        </div>
        <p className="mt-3 text-xs text-ink-muted">This demo doesn&apos;t send real messages, so deliveries, opens, clicks and real replies aren&apos;t tracked.</p>
      </Card>
    </>
  );
}

function JourneyRow({ j, onInspect, inspecting }: { j: Journey; onInspect: () => void; inspecting: boolean }) {
  const kindTag = { recovery: "REGAIN", hold: "Hold", imported: "Imported", experiment: "Experiment" }[j.kind];
  return (
    <tr className={`${trHover} ${inspecting ? "bg-plum" : ""}`} data-journey={j.id}>
      <td className={`${tdc} min-w-[180px]`}>
        <div className="font-semibold text-ink">{j.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5"><Tag tone="outline">{kindTag}</Tag><span className="text-xs text-ink-muted">{j.action}</span></div>
      </td>
      <td className={`${tdc} min-w-[200px] max-w-[300px] text-xs text-ink-soft`}>{j.trigger}</td>
      <td className={`${tdc} text-right tabular-nums text-ink`}>
        {j.customers.length}
        {j.holdout ? <div className="text-xs text-ink-muted">{j.holdout} holdout</div> : null}
      </td>
      <td className={tdc}><Tag tone={j.status === "Blocked" ? "red" : j.status === "Active" ? "plum" : "neutral"}>{j.status}</Tag></td>
      <td className={`${tdc} text-xs text-ink-soft`}>{when(j.lastActivity)}</td>
      <td className={`${tdc} text-ink-soft`}>
        {j.kind === "hold" || j.kind === "experiment" ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <>
            <div className="tabular-nums">{j.contacted} contacted · {j.responded} replied</div>
            <div className="text-xs text-ink-muted">{j.kind === "imported" ? "From imported records" : "Simulated in this demo"}</div>
          </>
        )}
      </td>
      <td className={`${tdc} text-ink-soft`}>
        {j.experiment ? (
          <div className="text-xs">
            <div>{j.experiment.observed} real · {j.experiment.simulated} simulated results</div>
            <div className="text-ink-muted">{j.experiment.pending} waiting</div>
          </div>
        ) : j.outcome && (j.outcome.eligible || j.outcome.windowOpen) ? (
          <div className="text-xs">
            <div className="tabular-nums">{j.outcome.eligible ? `${j.outcome.purchased} of ${j.outcome.eligible} within ${OUTCOME_WINDOW_DAYS} days` : "Too early to tell"}</div>
            {j.outcome.windowOpen > 0 && j.outcome.eligible > 0 && <div className="text-ink-muted">{j.outcome.windowOpen} too early to tell</div>}
          </div>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      <td className={`${tdc} text-right`}><Button size="sm" onClick={onInspect}>{inspecting ? "Show all" : "Show customers"}</Button></td>
    </tr>
  );
}

function Timeline({ c, journeyName }: { c: CustomerJourney; journeyName: (id: string) => string }) {
  const earlier = c.events.length === 0;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        {earlier ? (
          <EmptyState title="No events recorded">This customer has no purchases, contacts, Studio activity or experiment records in the loaded data.</EmptyState>
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-5" aria-label={`Timeline for ${c.customerId}`}>
            {c.events.map((e) => (
              <li key={e.id} className="relative" data-event={e.type}>
                <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${e.source === "simulated" ? "bg-plum-accent" : e.type === "purchase" ? "bg-good" : e.type === "opt_out" ? "bg-crimson" : "bg-info"}`} aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-xs tabular-nums text-ink-muted">{when(e)}</span>
                  <span className="text-sm font-medium text-ink">{EVENT_LABEL[e.type]}</span>
                  <SourceBadge s={e.source} />
                  {e.journeyId && <span className="text-2xs text-ink-faint">{journeyName(e.journeyId)}</span>}
                </div>
                <p className="text-sm text-ink-soft">{e.detail}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-ink-muted">Shows purchases from 90 days before the first follow-up. REGAIN doesn&apos;t record when a message was written.</p>
      </div>
      <aside className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{c.customerId}</span><DecisionBadge d={c.decision} /></div>
        <div><span className="text-ink-muted">Journey: </span>{journeyName(c.journeyId)}</div>
        <div><span className="text-ink-muted">Can contact? </span>{c.contact.allowed ? "Yes" : <Tag tone="red">{c.contact.label}</Tag>}</div>
        <div><span className="text-ink-muted">Result: </span>{PURCHASE_LABEL[c.purchase.status]}{c.purchase.windowEnd && c.purchase.status === "window_open" ? ` (check after ${c.purchase.windowEnd})` : ""}</div>
        <div className="rounded-md border border-line bg-surface-2 px-3 py-2"><div className="text-2xs font-medium uppercase tracking-wider text-ink-faint">What to do next</div><div className="text-ink">{c.next.text}</div></div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink size="sm" href={`/insights?id=${c.customerId}`}>Customer profile</ButtonLink>
          <ButtonLink size="sm" href={`/trial?id=${c.customerId}`}>Recovery Decisions</ButtonLink>
          <ButtonLink size="sm" href={`/studio?id=${c.customerId}`}>Conversation Studio</ButtonLink>
        </div>
      </aside>
    </div>
  );
}

function Metric({ name, value, def, kind, tip }: { name: string; value: string; def: string; kind: "observed" | "calculated" | "estimated" | "simulated" | "unvalidated"; tip?: string }) {
  return (
    <div>
      <dt className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-ink">{name}{tip && <span className="ml-1 inline-flex align-[-2px]"><InfoTip text={tip} /></span>}</span><Source kind={kind} /></dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
      <dd className="text-xs leading-snug text-ink-muted">{def}</dd>
    </div>
  );
}
