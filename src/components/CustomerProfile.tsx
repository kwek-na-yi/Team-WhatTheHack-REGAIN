"use client";
// One customer's behavioural profile. Used by Customer Insights (/insights) and by the
// direct customer link (/customers/[id]) so the profile exists in exactly one place.
import { useEffect, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { contactStatus, whatThisMeans } from "@/lib/insights";
import { ACTION_VERB, GLOSSARY, mainReason } from "@/lib/present";
import type { CustomerProfile as Profile, EvidenceKind } from "@/lib/types";
import { addDays, fmtMoney, fromDayNumber, toDayNumber } from "@/lib/utils";
import { useApp } from "./AppProvider";
import { CaseBar } from "./CaseBar";
import { AXIS, CHART, tooltipBox, tooltipProps } from "./chartTheme";
import { ButtonLink, Card, DecisionBadge, Disclosure, DisclosureGroup, EmptyState, Notice, PageHeader, Source, Stat, StatGroup, StatusBadge, Tag, td, th, type Provenance } from "./ui";

const LAYERS: { kind: EvidenceKind; title: string; source?: Provenance; help: string }[] = [
  { kind: "fact", title: "Facts", source: "observed", help: "" },
  { kind: "indicator", title: "Indicators", source: "calculated", help: "" },
  { kind: "explanation", title: "Possible explanations", help: "Ideas to check — not conclusions" },
  { kind: "unknown", title: "Unknown", help: "What the data can't tell us" },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2.5 text-sm last:border-0">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right text-ink">{children}</span>
    </div>
  );
}

/** The usual and current gap in plain English, always relative to this customer's own history. */
function rhythmLine(p: Profile): string {
  if (p.rhythmSource === "population") return `Only one purchase so far, ${p.recencyDays} days ago — there is no personal buying rhythm to compare against yet.`;
  const usual = Math.round(p.medianInterval as number);
  return `Usual gap: ${usual} days${p.rhythmSource === "provisional" ? " (provisional — one gap)" : ""}. Current gap: ${p.recencyDays} days since the last purchase (${p.overdueRatio}× usual). Compared with this customer's own past purchases, not with other customers.`;
}

export function CustomerProfile({ id, actions }: { id: string; actions?: ReactNode }) {
  const { state, dispatch, analysis } = useApp();
  const p = analysis.byId[id];
  // Keep this customer as the active case across Recovery Decisions, Studio and the workflow bar.
  useEffect(() => {
    if (p && state.selectedCustomerId !== id) dispatch({ type: "SELECT_CUSTOMER", customerId: id });
  }, [id, p]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <EmptyState title={`Customer “${id}” not found`} action={<ButtonLink href="/customers">Back to the directory</ButtonLink>} />;

  const t = analysis.trials[id];
  const history = state.interventions.filter((r) => r.customerId === id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const issues = p.orders.filter((o) => o.serviceIssue).reverse();
  const outliers = new Set(p.outlierOrderIds);
  const points = p.orders.map((o) => ({ x: toDayNumber(o.date), y: o.value, date: o.date, outlier: outliers.has(o.orderId), issue: o.serviceIssue }));
  const expectedNext = p.expectedInterval && p.rhythmSource !== "population" ? addDays(p.lastOrderDate, Math.round(p.expectedInterval)) : null;
  const gaps = p.intervals.map((g, i) => ({ i: i + 1, gap: g }));
  const hasRhythm = p.rhythmSource !== "population";
  const contact = contactStatus(t, p);

  return (
    <>
      <PageHeader
        title={`Customer ${p.customerId}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-3"><StatusBadge s={p.status} /><span>{p.orderCount} purchases since {p.firstOrderDate}</span></span>}
        actions={actions}
      />
      <CaseBar customerId={p.customerId} />

      <div className="mb-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="What this means" subtitle="In plain English, from this customer's own records">
          <ul className="space-y-1.5 text-sm text-ink-soft">{whatThisMeans(p, t).map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Card>
        <Card className="border-l-2 border-l-plum-accent">
          <div className="flex items-center gap-2"><span className="text-2xs font-medium uppercase tracking-wider text-ink-faint">Recommendation</span><DecisionBadge d={t.decision} /></div>
          <div className="mt-1 text-lg font-semibold text-ink">{ACTION_VERB[t.recommendedAction]}</div>
          <p className="mt-1 text-sm text-ink-soft">{mainReason(t)}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href={`/trial?id=${p.customerId}`} variant="primary">Review recommendation</ButtonLink>
            {t.decision !== "HOLD" && <ButtonLink href={`/studio?id=${p.customerId}`}>Review message</ButtonLink>}
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            {t.decision === "HOLD"
              ? "Recovery Decisions shows every action compared with doing nothing, and why REGAIN is holding."
              : "Recovery Decisions compares every action with doing nothing. Conversation Studio drafts the message for your review — sends are simulated in this prototype."}
          </p>
        </Card>
      </div>

      <StatGroup>
        <Stat label="Days since last purchase" value={p.recencyDays} hint={p.lastOrderDate} tip={GLOSSARY.daysSince} tag={<Source kind="observed" />} />
        <Stat label="Usual gap" value={hasRhythm ? `${Math.round(p.medianInterval as number)} days` : "Not enough history"} hint={p.rhythmSource === "provisional" ? "Provisional — one gap" : hasRhythm ? `Median of ${p.intervals.length} gaps` : "Only one purchase"} tip={GLOSSARY.usualGap} tag={<Source kind="calculated" />} />
        <Stat label="Versus own pattern" value={hasRhythm ? `${p.overdueRatio}×` : "—"} tone={p.overdueRatio && p.overdueRatio >= 2 ? "bad" : undefined} hint={hasRhythm ? "Current gap ÷ usual gap" : undefined} tip={GLOSSARY.vsRhythm} />
        <Stat label="Spending change" value={p.spendTrend === null ? "—" : `${p.spendTrend >= 0 ? "+" : ""}${Math.round(p.spendTrend * 100)}%`} hint="Last 6 months vs the 6 before" tone={p.spendTrend !== null && p.spendTrend <= -0.25 ? "bad" : undefined} />
      </StatGroup>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Purchase timeline" subtitle="When this customer bought, and how much — each dot is one order">
          <div className="h-64" role="img" aria-label={`Scatter chart of ${p.orderCount} orders from ${p.firstOrderDate} to ${p.lastOrderDate}. ${rhythmLine(p)}`}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 18 }}>
                <CartesianGrid stroke={CHART.grid} />
                <XAxis type="number" dataKey="x" domain={[toDayNumber(p.firstOrderDate) - 10, toDayNumber(state.asOf) + 5]} tick={AXIS} tickFormatter={(d: number) => fromDayNumber(d).slice(2, 7).replace("-", "/")} stroke={CHART.ref} label={{ value: "Purchase date (yy/mm)", position: "insideBottom", offset: -12, fontSize: 11, fill: CHART.axis }} />
                <YAxis type="number" dataKey="y" tick={AXIS} tickFormatter={(v: number) => `$${v}`} stroke={CHART.ref} width={56} label={{ value: "Order value ($)", angle: -90, position: "insideLeft", fontSize: 11, fill: CHART.axis, style: { textAnchor: "middle" } }} />
                <ZAxis range={[56, 56]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as (typeof points)[number] | undefined;
                    if (!d) return null;
                    return (
                      <div className={tooltipBox}>
                        <div className="font-semibold">{d.date}</div>
                        <div>{fmtMoney(d.y, 2)}{d.outlier ? " · unusually large" : ""}</div>
                        {d.issue && <div className="text-crimson-text">Complaint: {d.issue}</div>}
                      </div>
                    );
                  }}
                />
                <ReferenceLine x={toDayNumber(state.asOf)} stroke={CHART.ref} strokeDasharray="4 3" label={{ value: "Today", fontSize: 11, fill: CHART.axis, position: "insideBottomRight" }} />
                {expectedNext && expectedNext <= state.asOf && (
                  <ReferenceLine x={toDayNumber(expectedNext)} stroke={CHART.primary} strokeDasharray="4 3" label={{ value: "Expected", fontSize: 11, fill: CHART.primaryStrong, position: "insideTopRight" }} />
                )}
                <Scatter isAnimationActive={false} name="Purchase" data={points.filter((d) => !d.outlier && !d.issue)} fill={CHART.primary} />
                <Scatter isAnimationActive={false} name="Unusually large" data={points.filter((d) => d.outlier)} fill={CHART.compare} shape="diamond" />
                <Scatter isAnimationActive={false} name="Complaint" data={points.filter((d) => d.issue)} fill={CHART.risk} shape="triangle" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-plum-accent" />Purchase</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 bg-info" />Unusually large (ignored for the typical value)</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0 w-0 border-x-4 border-b-[7px] border-x-transparent border-b-crimson" />Purchase with a complaint</span>
          </div>
          <p className="mt-2 text-sm text-ink-soft" data-testid="rhythm-line">{rhythmLine(p)}</p>
        </Card>

        <Card title="Profile">
          <Row label="Marketing consent">{p.optedOut === "yes" ? <Tag tone="red">Opted out</Tag> : p.marketingConsent === "yes" ? <Tag tone="green">Yes</Tag> : <Tag tone="outline">{p.marketingConsent === "no" ? "No" : "Not recorded"}</Tag>}</Row>
          <Row label="Contact eligibility">{contact.allowed ? <span>Allowed</span> : <Tag tone="red">{contact.label}</Tag>}</Row>
          <Row label="Main category">{p.topCategory}</Row>
          <Row label="Typical order">{fmtMoney(p.typicalOrderValue, 2)}</Row>
          <Row label="Total spend">{fmtMoney(p.totalSpend)}</Row>
          <Row label="Evidence behind the recommendation"><span className="capitalize">{p.evidenceLevel}</span></Row>
          <div className="mt-4 text-xs font-medium text-ink-muted">Recorded service interactions</div>
          {issues.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">None recorded.</p>
          ) : (
            <ul className="mt-1 space-y-1.5 text-sm">
              {issues.map((o) => (
                <li key={o.orderId} className="text-ink-soft"><span className="tabular-nums text-ink">{o.date}</span> · {o.serviceIssue} · <span className={o.serviceIssueResolved === "yes" ? "text-good" : "text-crimson-text"}>{o.serviceIssueResolved === "yes" ? "resolved" : "unresolved"}</span></li>
              ))}
            </ul>
          )}
          <div className="mt-4 text-xs font-medium text-ink-muted">Previous recovery actions</div>
          {history.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">None recorded.</p>
          ) : (
            <ul className="mt-1 space-y-2 text-sm">
              {history.slice(0, 4).map((h, i) => (
                <li key={i} className="text-ink-soft">
                  <span className="tabular-nums text-ink">{h.date}</span> · {h.group === "control" ? "Comparison group (not contacted)" : h.action.replace("_", " ")}
                  {h.source === "app" && <span className="ml-1"><Source kind="simulated" /></span>}
                  <div className="text-xs text-ink-muted">Bought again afterwards: {h.purchased}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <DisclosureGroup className="mt-7">
        <Disclosure flush title="See why — the evidence" hint="Facts, calculations, ideas to check, unknowns" defaultOpen>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {LAYERS.map((l) => {
              const items = p.evidence.filter((e) => e.kind === l.kind);
              return (
                <div key={l.kind}>
                  <div className="flex items-center gap-2"><span className="text-sm font-semibold text-ink">{l.title}</span>{l.source ? <Source kind={l.source} /> : <span className="text-xs text-ink-muted">{l.help}</span>}</div>
                  <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">{items.length ? items.map((e, i) => <li key={i}>{e.text}</li>) : <li className="text-ink-muted">None</li>}</ul>
                </div>
              );
            })}
          </div>
        </Disclosure>

        <Disclosure flush title="Confidence and limitations" hint={`Evidence: ${p.evidenceLevel}`}>
          <p className="text-sm text-ink-soft">Data-sufficiency score {p.evidenceScore} (purchase count, regularity, category and consent data). It measures how much evidence exists — it is not a probability.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">{p.limitations.length ? p.limitations.map((l, i) => <li key={i}>{l}</li>) : <li>No specific limitations.</li>}</ul>
        </Disclosure>

        <Disclosure flush title="Gaps between purchases" hint={hasRhythm ? `Median ${Math.round(p.medianInterval as number)} days` : "Not enough history"}>
          {gaps.length === 0 ? (
            <Notice tone="warn">Only one purchase date — a personal pattern can&apos;t be estimated.</Notice>
          ) : (
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={gaps} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="i" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipProps} formatter={(v: number) => [`${v} days`, "Gap"]} labelFormatter={(l: number) => `Gap ${l}`} />
                  {p.medianInterval !== null && <ReferenceLine y={p.medianInterval} stroke={CHART.primaryStrong} strokeDasharray="4 3" />}
                  <Bar isAnimationActive={false} dataKey="gap" fill={CHART.primary} radius={[3, 3, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Disclosure>

        <Disclosure flush title="Purchase history" hint={`${p.orderCount} purchases`}>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr><th className={th}>Date</th><th className={th}>Order</th><th className={th}>Categories</th><th className={`${th} text-right`}>Value</th><th className={th}>Complaint</th></tr>
              </thead>
              <tbody>
                {[...p.orders].reverse().map((o) => (
                  <tr key={o.orderId} className="border-t border-line">
                    <td className={`${td} py-2 tabular-nums`}>{o.date}</td>
                    <td className={`${td} py-2 text-ink-muted`}>{o.orderId}</td>
                    <td className={`${td} py-2`}>{o.categories.join(", ")}</td>
                    <td className={`${td} py-2 text-right tabular-nums`}>{fmtMoney(o.value, 2)}</td>
                    <td className={`${td} py-2`}>{o.serviceIssue ? <span className="text-crimson-text">{o.serviceIssue} ({o.serviceIssueResolved === "yes" ? "resolved" : "open"})</span> : <span className="text-ink-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      </DisclosureGroup>
    </>
  );
}
