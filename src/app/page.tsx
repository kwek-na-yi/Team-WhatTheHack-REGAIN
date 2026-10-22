"use client";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/AppProvider";
import { AXIS, CHART, tooltipProps } from "@/components/chartTheme";
import { DemoCases, WelcomeGuide } from "@/components/Onboarding";
import { ButtonLink, Card, DataGate, DecisionBadge, Disclosure, PageHeader, Source, Stat, StatGroup, StatusBadge, td, TextLink, th, trHover } from "@/components/ui";
import { monthlyRevenue, STATUS_LABEL } from "@/lib/behaviour";
import { analyseHistorical } from "@/lib/experiment";
import { ACTION_VERB, GLOSSARY, holdReason, signalText } from "@/lib/present";
import type { BehaviourStatus } from "@/lib/types";
import { fmtMoney, fmtPp } from "@/lib/utils";

const OPEN_STATES = new Set(["draft", "rejected", "awaiting_response", "positive", "declined", "service_issue", "info_requested"]);
// Each colour has one meaning: green = buying as usual, plum = slipping, crimson = lapsed (at risk), grey = other.
const STATUS_COLOR: Record<BehaviourStatus, string> = {
  on_rhythm: CHART.good,
  slipping: CHART.primary,
  lapsed: CHART.risk,
  dormant: CHART.neutral,
  new: CHART.neutral,
  insufficient_history: CHART.faint,
};

export default function CommandCentre() {
  return (
    <DataGate>
      <Inner />
    </DataGate>
  );
}

function Inner() {
  const { state, analysis } = useApp();
  const { profiles, trials, counts } = analysis;
  const months = useMemo(() => monthlyRevenue(state.transactions, state.asOf, 12), [state.transactions, state.asOf]);
  const historical = useMemo(() => analyseHistorical(state.interventions), [state.interventions]);

  const attention = counts.RECOVER + counts.UNDERSTAND;
  const pending = Object.values(state.conversations).filter((c) => OPEN_STATES.has(c.status)).length;
  const queue = Object.values(trials).filter((t) => t.decision !== "HOLD").sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 6);
  const statusOrder: BehaviourStatus[] = ["on_rhythm", "slipping", "lapsed", "dormant", "new", "insufficient_history"];
  const statusData = statusOrder.map((s) => ({ key: s, name: STATUS_LABEL[s], value: profiles.filter((p) => p.status === s).length }));
  const holdReasons = Object.entries(
    Object.values(trials).filter((t) => t.decision === "HOLD").reduce<Record<string, number>>((acc, t) => {
      const k = holdReason(t);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const h = historical[0];

  return (
    <>
      <PageHeader
        title="Command Centre"
        subtitle="Review customer changes and decide which actions are worth taking."
        actions={<ButtonLink href="/customers?decision=act" variant="primary">Review recommended actions</ButtonLink>}
      />

      <WelcomeGuide />

      <StatGroup>
        <Stat label="Customers analysed" value={profiles.length} hint={`${state.transactions.length.toLocaleString()} transactions`} />
        <Stat label="Customers requiring review" value={attention} hint={`${counts.RECOVER} recover · ${counts.UNDERSTAND} ask first · ${counts.HOLD} on hold`} tip={GLOSSARY.needAttention} />
        <Stat label="Pending recovery actions" value={pending} hint={pending ? "Drafts or awaiting a reply" : "No conversations started yet"} />
        <Stat label="Estimated contribution opportunity" value={fmtMoney(analysis.expectedIncremental)} hint="Next 90 days, if every recommended action is taken" tag={<Source kind="estimated" />} tip={GLOSSARY.extraContribution} />
      </StatGroup>

      <Card
        title="Priority actions"
        subtitle="Start here — the customers where a recovery action is most likely to be worth it"
        className="mt-7"
        padded={false}
        right={<TextLink href="/customers?decision=act">See all {attention}</TextLink>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className={th}>Customer</th>
                <th className={th}>What changed</th>
                <th className={th}>Recommended next action</th>
                <th className={`${th} text-right`}>Est. value</th>
                <th className={th}><span className="sr-only">Review case</span></th>
              </tr>
            </thead>
            <tbody>
              {queue.map((t) => {
                const p = analysis.byId[t.customerId];
                return (
                  <tr key={t.customerId} className={trHover}>
                    <td className={td}>
                      <div className="font-semibold text-ink">{t.customerId}</div>
                      <StatusBadge s={p.status} />
                    </td>
                    <td className={`${td} text-ink-soft`}>{signalText(p)}</td>
                    <td className={td}>
                      <div className="text-ink">{ACTION_VERB[t.recommendedAction]}</div>
                      <DecisionBadge d={t.decision} />
                    </td>
                    <td className={`${td} text-right tabular-nums text-ink`}>{fmtMoney(t.priorityScore, 2)}</td>
                    <td className={`${td} text-right`}><ButtonLink href={`/trial?id=${t.customerId}`} size="sm">Review case</ButtonLink></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Customers by buying pattern" subtitle="Days since the last purchase compared with each customer's usual gap">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={statusData} layout="vertical" margin={{ top: 4, right: 36, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={AXIS} width={122} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [v, "Customers"]} />
                <Bar isAnimationActive={false} dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={18}>
                  {statusData.map((d) => <Cell key={d.key} fill={STATUS_COLOR[d.key]} />)}
                  <LabelList dataKey="value" position="right" style={{ fontSize: 12, fill: CHART.label, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <div className="min-w-0"><DemoCases /></div>
      </div>

      <Disclosure title="More detail" hint="Revenue over time · why customers are on hold · last test" className="mt-7">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-2 text-sm font-medium text-ink">Monthly revenue</div>
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={months} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="month" tick={AXIS} tickFormatter={(m: string) => m.slice(2).replace("-", "/")} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} />
                  <Tooltip {...tooltipProps} cursor={{ stroke: CHART.ref }} formatter={(v: number) => [fmtMoney(v), "Revenue"]} labelFormatter={(l: string) => `Month ${l}`} />
                  <Line isAnimationActive={false} type="monotone" dataKey="revenue" stroke={CHART.primary} strokeWidth={2} dot={{ r: 3, fill: CHART.primary }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-xs text-ink-muted">The latest month is partial (up to {state.asOf}).</p>
          </div>
          <div className="space-y-6">
            <div>
              <div className="mb-2 text-sm font-medium text-ink">Why customers are on hold</div>
              <ul className="space-y-1.5 text-sm">
                {holdReasons.map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2"><span className="text-ink-muted">{k}</span><span className="tabular-nums text-ink">{v}</span></li>
                ))}
              </ul>
            </div>
            {h && (
              <div>
                <div className="mb-1 text-sm font-medium text-ink">Last measured test</div>
                <div className="text-sm text-ink-muted">{h.campaign}: <span className="text-ink">{fmtPp(h.diffPp)}</span> (likely range {fmtPp(h.diffCi[0])} to {fmtPp(h.diffCi[1])})</div>
                <div className="mt-2"><TextLink href="/impact">View results</TextLink></div>
              </div>
            )}
          </div>
        </div>
      </Disclosure>
    </>
  );
}
