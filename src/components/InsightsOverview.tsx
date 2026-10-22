"use client";
// Customer Insights overview: the whole customer base at a glance, linking to each customer's profile.
// Every number is derived from the loaded records and the engine (see lib/insights.ts).
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { contactStatus, conversationJourney, latestContribution, priorityIds, purchaseTrend, repeatPurchaseRate, averageOrderValue, type PriorityFilter, type TrendMetric, type TrendPoint, type TrendRange } from "@/lib/insights";
import { ACTION_SHORT, DECISION_DEF, GLOSSARY, signalText } from "@/lib/present";
import type { Decision } from "@/lib/types";
import { fmtMoney, fmtPct, fmtPp } from "@/lib/utils";
import { useApp } from "./AppProvider";
import { AXIS, CHART, tooltipBox } from "./chartTheme";
import { Button, ButtonLink, Card, DecisionBadge, EmptyState, Icon, Notice, PageHeader, Pager, Segmented, Source, Stat, StatGroup, Tag, td, TextLink, th, trHover } from "./ui";

const PAGE = 10;
const DECISIONS: Decision[] = ["RECOVER", "UNDERSTAND", "HOLD"];
// Plum = act, blue-grey = investigate, neutral grey = leave alone. Labels always accompany colour.
const DECISION_COLOR: Record<Decision, string> = { RECOVER: CHART.primary, UNDERSTAND: CHART.compare, HOLD: CHART.neutral };
const RANGE_LABEL: Record<TrendRange, string> = { "3m": "last 3 months", "6m": "last 6 months", "12m": "last 12 months", all: "all history" };
const REPLY_LABEL = { interested: "interested", not_interested: "not interested", service_problem: "service problem", needs_info: "asked for information" } as const;

export function InsightsOverview({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, analysis } = useApp();
  const [range, setRange] = useState<TrendRange>("12m");
  const [metric, setMetric] = useState<TrendMetric>("orders");
  const [filter, setFilter] = useState<PriorityFilter>("attention");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filter, q]);

  const trend = useMemo(() => purchaseTrend(analysis.profiles, state.asOf, range), [analysis.profiles, state.asOf, range]);
  const repeat = useMemo(() => repeatPurchaseRate(analysis.profiles, state.asOf), [analysis.profiles, state.asOf]);
  const ids = useMemo(() => priorityIds(analysis, filter, q), [analysis, filter, q]);
  const journey = useMemo(() => conversationJourney(analysis, state.conversations, state.experiments), [analysis, state.conversations, state.experiments]);
  const contribution = useMemo(() => latestContribution(state.experiments, state.interventions), [state.experiments, state.interventions]);
  const aov = averageOrderValue(trend);
  const { counts, suppressed } = analysis;
  const total = analysis.profiles.length;
  const attention = counts.RECOVER + counts.UNDERSTAND;
  const blocked = suppressed.no_consent + suppressed.opted_out + suppressed.frequency_cap + suppressed.declined;
  const caseId = state.selectedCustomerId && analysis.byId[state.selectedCustomerId] ? state.selectedCustomerId : null;
  const breakdown = DECISIONS.map((d) => ({ key: d, name: DECISION_DEF[d].title, value: counts[d] }));
  const pages = Math.ceil(ids.length / PAGE);
  const showTable = (d: PriorityFilter) => {
    setFilter(d);
    document.getElementById("priority")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <PageHeader
        title="Customer Insights"
        subtitle="Understand buying behaviour, identify customers who need attention and measure repeat purchases."
        actions={
          <>
            {state.dataSource === "sample" && <Tag tone="plum" title="Fictional customers generated for the demo">Demo mode · Synthetic data</Tag>}
            {state.dataSource === "upload" && <Tag tone="outline">Your uploaded data</Tag>}
            <span className="text-xs text-ink-muted">Data as of {state.asOf}</span>
            {caseId && <Button size="sm" onClick={() => onOpen(caseId)}>Active case {caseId} →</Button>}
          </>
        }
      />

      <StatGroup>
        <Stat label="Customers analysed" value={total} hint={`${state.transactions.length.toLocaleString()} transaction lines`} tip="Every customer with at least one valid purchase in the loaded data, up to the analysis date." tag={<Source kind="observed" />} />
        <Stat label="Customers requiring review" value={attention} hint={`${counts.RECOVER} Recover · ${counts.UNDERSTAND} Understand`} tip={`${GLOSSARY.needAttention} Same definition as the Command Centre. Out of ${total} customers.`} tag={<Source kind="calculated" />} />
        <Stat
          label={`${repeat.windowDays}-day repeat-purchase rate`}
          value={repeat.rate === null ? "Not available" : fmtPct(repeat.rate, 1)}
          hint={repeat.rate === null ? `No customer's first purchase is ${repeat.windowDays}+ days old yet` : `${repeat.repeated} of ${repeat.eligible} customers bought again`}
          tip={`Customers whose first purchase was at least ${repeat.windowDays} days before ${state.asOf}, who placed another order on a later day within ${repeat.windowDays} days of it. ${repeat.stillOpen} newer customers are excluded because their window is still open.`}
          tag={<Source kind="calculated" />}
        />
        <Stat label="Estimated contribution opportunity" value={fmtMoney(analysis.expectedIncremental)} hint={`Next ${state.assumptions.horizonDays} days · unvalidated estimate`} tip={`Sum of the estimated extra contribution (margin after costs, versus doing nothing) of every Recover and Understand action. ${GLOSSARY.extraContribution} Not realised revenue.`} tag={<Source kind="estimated" />} />
      </StatGroup>

      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          title="How are customers buying?"
          subtitle={`${metric === "orders" ? "Orders" : "Revenue"} per ${trend.grain}, ${RANGE_LABEL[range]}. Shows what happened, not why.`}
          right={
            <div className="flex flex-wrap gap-2">
              <Segmented<TrendMetric> label="Measure" value={metric} onChange={setMetric} options={[{ value: "orders", label: "Orders" }, { value: "revenue", label: "Revenue" }]} />
              <Segmented<TrendRange> label="Date range" value={range} onChange={setRange} options={[{ value: "3m", label: "3M" }, { value: "6m", label: "6M" }, { value: "12m", label: "12M" }, { value: "all", label: "All" }]} />
            </div>
          }
        >
          {trend.orders === 0 ? (
            <EmptyState title="No orders in this period">Choose a longer date range, or check the analysis date in Data &amp; Integrations.</EmptyState>
          ) : (
            <>
              <div className="h-64" role="img" aria-label={`Line chart of ${metric} per ${trend.grain}, ${RANGE_LABEL[range]}: ${trend.orders} orders, ${fmtMoney(trend.revenue)} revenue in total.`}>
                <ResponsiveContainer>
                  <LineChart data={trend.points} margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={18} label={{ value: trend.grain === "week" ? "Week ending" : "Month", position: "insideBottom", offset: -12, fontSize: 11, fill: CHART.axis }} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} allowDecimals={false} tickFormatter={(v: number) => (metric === "revenue" ? (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`) : String(v))} label={{ value: metric === "orders" ? "Orders" : "Revenue ($)", angle: -90, position: "insideLeft", offset: 0, fontSize: 11, fill: CHART.axis, style: { textAnchor: "middle" } }} />
                    <Tooltip
                      cursor={{ stroke: CHART.ref, strokeDasharray: "3 3" }}
                      content={({ payload }) => {
                        const d = payload?.[0]?.payload as TrendPoint | undefined;
                        if (!d) return null;
                        return (
                          <div className={tooltipBox}>
                            <div className="font-semibold">{d.start === d.end ? d.start : `${d.start} – ${d.end}`}{d.partial ? " (month so far)" : ""}</div>
                            <div>{d.orders} orders · {fmtMoney(d.revenue)}</div>
                            <div className="text-ink-muted">{d.customers} customers</div>
                          </div>
                        );
                      }}
                    />
                    <Line isAnimationActive={false} type="monotone" dataKey={metric} stroke={CHART.primaryStrong} strokeWidth={2} dot={trend.points.length <= 14 ? { r: 3, fill: CHART.primaryStrong } : false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                {trend.orders.toLocaleString()} orders · {fmtMoney(trend.revenue)} · {trend.from} to {trend.to}.
                {trend.points.some((p) => p.partial) && " The last month is not over yet, so it looks lower."} A rise or fall here is not evidence that any marketing action worked — that needs a holdout test.
              </p>
            </>
          )}
        </Card>

        <Card title="Who needs attention?" subtitle="REGAIN's current decision for every customer. Click a bar to list those customers.">
          <div className="h-[150px]">
            <ResponsiveContainer>
              <BarChart data={breakdown} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }}>
                <XAxis type="number" hide domain={[0, "dataMax"]} />
                <YAxis type="category" dataKey="name" tick={AXIS} width={86} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: CHART.cursor }} content={({ payload }) => { const d = payload?.[0]?.payload as (typeof breakdown)[number] | undefined; return d ? <div className={tooltipBox}><div className="font-semibold">{d.name}: {d.value} customers</div><div className="text-ink-muted">{total ? fmtPct(d.value / total) : "0%"} of {total}</div></div> : null; }} />
                <Bar isAnimationActive={false} dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={22} onClick={(d: { key?: Decision; payload?: { key?: Decision } }) => {
                  const k = d.payload?.key ?? d.key;
                  if (k) showTable(k);
                }} className="cursor-pointer">
                  {breakdown.map((d) => <Cell key={d.key} fill={DECISION_COLOR[d.key]} />)}
                  <LabelList dataKey="value" position="right" style={{ fontSize: 12, fill: CHART.label, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Show customers by decision">
            {breakdown.map((d) => (
              <Button key={d.key} size="sm" variant={filter === d.key ? "primary" : "secondary"} onClick={() => showTable(d.key)}>
                Show {d.name} ({d.value})
              </Button>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-xs leading-snug text-ink-soft">
            <li><span className="font-semibold text-ink">Recover</span> — act: the evidence and the estimates support a recovery action.</li>
            <li><span className="font-semibold text-ink">Understand</span> — ask first: buying changed, but the data doesn&apos;t show why.</li>
            <li><span className="font-semibold text-ink">Hold</span> — leave alone for now: buying normally, not worth the cost, or contact not allowed ({blocked} blocked by consent or contact rules).</li>
          </ul>
        </Card>
      </div>

      <Card
        title="Priority customers"
        subtitle="Ranked by decision, then by the estimated extra contribution of the recommended action — not by past spend."
        className="mt-7 scroll-mt-20"
        padded={false}
      >
        <div id="priority" className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="relative">
            <span className="sr-only">Search customer ID</span>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer ID" aria-label="Search priority customers" className="h-9 w-44 rounded-md border border-line-strong bg-surface pl-8 pr-2 text-sm text-ink placeholder:text-ink-faint" />
          </label>
          <Segmented<PriorityFilter>
            label="Decision filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "attention", label: "Needs attention", count: attention },
              { value: "RECOVER", label: "Recover", count: counts.RECOVER },
              { value: "UNDERSTAND", label: "Understand", count: counts.UNDERSTAND },
              { value: "HOLD", label: "Hold", count: counts.HOLD },
              { value: "all", label: "All", count: total },
            ]}
          />
        </div>
        {ids.length === 0 ? (
          <div className="p-6"><EmptyState title="No customers match">{q ? "No customer ID contains that text." : "No customers have this decision."}</EmptyState></div>
        ) : (
          <>
            {/* Phones: one compact card per customer, so contact status and "View customer" stay visible. */}
            <ul className="divide-y divide-line md:hidden" aria-label="Priority customers (list)">
              {ids.slice(page * PAGE, page * PAGE + PAGE).map((id) => {
                const p = analysis.byId[id];
                const t = analysis.trials[id];
                const c = contactStatus(t, p);
                return (
                  <li key={id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-semibold text-ink">{id}</span>
                      <DecisionBadge d={t.decision} />
                      <span className="text-ink-soft">· {ACTION_SHORT[t.recommendedAction]}</span>
                      {t.decision !== "HOLD" && <span className="ml-auto tabular-nums text-ink">{fmtMoney(t.priorityScore, 2)} est.</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">{signalText(p)} · evidence {p.evidenceLevel}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {c.allowed ? <span className="text-xs text-ink-soft">Contact allowed</span> : <Tag tone="red">{c.label}</Tag>}
                      <Button size="sm" onClick={() => onOpen(id)}>View customer</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-sm" aria-label="Priority customers">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Customer</th>
                    <th className={th}>Main buying signal</th>
                    <th className={th}>Decision</th>
                    <th className={th}>Recommended action</th>
                    <th className={th}>Evidence</th>
                    <th className={`${th} text-right`}>Est. extra contribution</th>
                    <th className={th}>Contact</th>
                    <th className={th}><span className="sr-only">View customer</span></th>
                  </tr>
                </thead>
                <tbody>
                  {ids.slice(page * PAGE, page * PAGE + PAGE).map((id) => {
                    const p = analysis.byId[id];
                    const t = analysis.trials[id];
                    const c = contactStatus(t, p);
                    return (
                      <tr key={id} className={trHover} data-customer={id}>
                        <td className={`${td} font-semibold text-ink`}>{id}</td>
                        <td className={`${td} text-ink-soft`}>{signalText(p)}</td>
                        <td className={td}><DecisionBadge d={t.decision} /></td>
                        <td className={`${td} text-ink-soft`}>{ACTION_SHORT[t.recommendedAction]}</td>
                        <td className={`${td} capitalize text-ink-soft`}>{p.evidenceLevel}</td>
                        <td className={`${td} text-right tabular-nums`}>{t.decision === "HOLD" ? <span className="text-ink-muted">—</span> : <span className="text-ink">{fmtMoney(t.priorityScore, 2)}</span>}</td>
                        <td className={td} data-contact={c.allowed ? "allowed" : "blocked"}>{c.allowed ? <span className="text-ink-soft">Allowed</span> : <Tag tone="red">{c.label}</Tag>}</td>
                        <td className={`${td} text-right`}><Button size="sm" onClick={() => onOpen(id)}>View customer</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line">
              <Pager page={page} pages={pages} onPage={setPage} total={ids.length} label="customers" />
            </div>
          </>
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">Estimated values come from the Recovery Trial&apos;s editable assumptions and are not measured results. &ldquo;Allowed&rdquo; means consent is recorded and no opt-out, decline or contact limit applies.</p>
      </Card>

      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <Card title="Conversation journey" subtitle="How far recommended customers have moved through REGAIN, from the records that exist. Stages 3–4 are simulated.">
          <ol className="space-y-3" aria-label="Conversation journey stages">
            {journey.stages.map((s, i) => (
              <li key={s.key} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-ink-soft" aria-hidden="true">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-ink">{s.label}</span>
                    <span className="text-lg font-semibold tabular-nums text-ink" data-stage={s.key}>{s.count}</span>
                    {s.shareOfPrevious !== null && <span className="text-xs text-ink-muted">{fmtPct(s.shareOfPrevious)} of stage {i}</span>}
                    {s.simulated && <Source kind="simulated" />}
                  </div>
                  <p className="text-xs leading-snug text-ink-muted">{s.help}</p>
                  {s.key === "replied" && s.count > 0 && (
                    <p className="text-xs text-ink-soft">{Object.entries(journey.replies).map(([k, n]) => `${n} ${REPLY_LABEL[k as keyof typeof REPLY_LABEL]}`).join(" · ")}</p>
                  )}
                </div>
              </li>
            ))}
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-ink-soft" aria-hidden="true">5</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">Repeat purchase measured</div>
                {journey.outcomes.experiments === 0 ? (
                  <p className="text-xs text-ink-muted">No holdout experiment yet, so no outcome has been measured. Outcomes are measured per experiment group, not per conversation.</p>
                ) : (
                  <p className="text-xs leading-snug text-ink-soft" data-stage="measured">
                    Observed: {journey.outcomes.observed.recorded} outcomes ({journey.outcomes.observed.purchased} bought again). Simulated: {journey.outcomes.simulated.recorded} ({journey.outcomes.simulated.purchased} bought again — not real purchases). Pending: {journey.outcomes.pending}, not counted either way.
                  </p>
                )}
              </div>
            </li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3 text-xs">
            <TextLink href="/studio">Conversation Studio</TextLink>
            <TextLink href="/impact">Impact &amp; Experiments</TextLink>
          </div>
          <p className="mt-2 text-xs text-ink-muted">In this prototype, sends and replies are simulated. No conversion rate is shown across stages that measure different groups of customers.</p>
        </Card>

        <Card title="Repeat purchases and value" subtitle="How each figure is calculated, and how reliable it is">
          <dl className="divide-y divide-line text-sm">
            <Metric
              name={`${repeat.windowDays}-day repeat-purchase rate`}
              source="calculated"
              value={repeat.rate === null ? "Not available" : `${fmtPct(repeat.rate, 1)} (${repeat.repeated} of ${repeat.eligible})`}
              formula={`Customers who placed another order on a later day within ${repeat.windowDays} days of their first purchase ÷ customers whose first purchase was at least ${repeat.windowDays} days before ${state.asOf}. ${repeat.stillOpen} customers are still inside their window and excluded.`}
            />
            <Metric
              name="Average order value"
              source="calculated"
              value={aov === null ? "Not available" : fmtMoney(aov, 2)}
              formula={`Total order value ÷ number of orders, ${RANGE_LABEL[range]} (${trend.from} to ${trend.to}; follows the date range above). Lines with the same order ID count as one order.`}
            />
            {contribution.kind === "experiment" ? (
              <Metric
                name="Incremental contribution"
                source={contribution.simulated ? "simulated" : "calculated"}
                value={`${fmtMoney(contribution.value, 2)}${contribution.simulated ? " (simulated)" : ""}`}
                formula={`${contribution.title}: extra purchases in the treatment group versus the control group, at margin, minus contact, discount and benefit costs (Impact & Experiments). Difference ${fmtPp(contribution.diffPp)}, 95% interval ${fmtPp(contribution.ci[0])} to ${fmtPp(contribution.ci[1])}; ${contribution.treatmentN} treatment / ${contribution.controlN} control${contribution.pending ? `, ${contribution.pending} pending` : ""}.${contribution.simulated ? " Outcomes are simulated from REGAIN's own assumptions — not evidence of real impact." : contribution.ci[0] <= 0 && contribution.ci[1] >= 0 ? " The interval includes zero, so the true effect could be none." : ""}`}
              />
            ) : contribution.kind === "imported" ? (
              <Metric
                name="Incremental contribution"
                source="unvalidated"
                value="Not calculated"
                formula={`The only result available is the imported campaign “${contribution.title}”: repeat-purchase difference ${fmtPp(contribution.diffPp)} (95% interval ${fmtPp(contribution.ci[0])} to ${fmtPp(contribution.ci[1])}; ${contribution.treatmentN} vs ${contribution.controlN}). Its records don't include costs or order values, and REGAIN can't verify how the groups were assigned, so a contribution isn't calculated. Run a holdout experiment to measure one.`}
              />
            ) : (
              <Metric name="Incremental contribution" source="unvalidated" value="Not available" formula="No experiment or campaign with a comparison group has recorded outcomes yet. Create a holdout experiment on Impact & Experiments." />
            )}
          </dl>
          <div className="mt-3" />
          <Notice tone="info">Lifetime value is not predicted. A forecast would need validated retention and margin assumptions this prototype doesn&apos;t have yet — it is planned, not built.</Notice>
          <div className="mt-3"><ButtonLink href="/impact" size="sm">Open Impact &amp; Experiments</ButtonLink></div>
        </Card>
      </div>
    </>
  );
}

function Metric({ name, value, formula, source }: { name: string; value: string; formula: string; source: "calculated" | "estimated" | "simulated" | "unvalidated" | "observed" }) {
  return (
    <div className="py-3 first:pt-0">
      <dt className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{name}</span><Source kind={source} /></dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
      <dd className="mt-0.5 text-xs leading-snug text-ink-muted">{formula}</dd>
    </div>
  );
}
