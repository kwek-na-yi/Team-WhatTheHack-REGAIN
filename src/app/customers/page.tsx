"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Button, ButtonLink, Card, DataGate, DecisionBadge, EmptyState, Icon, PageHeader, Pager, Segmented, selectCls, StatusBadge, Tag, td, th, trHover } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/behaviour";
import { ACTION_VERB, holdReason, signalText } from "@/lib/present";
import type { BehaviourStatus, Decision } from "@/lib/types";

type SortKey = "priority" | "overdue" | "recency" | "spend" | "id";
type DecisionFilter = "all" | "act" | Decision;
const PAGE = 25;

export default function CustomersPage() {
  return (
    <DataGate>
      <Inner />
    </DataGate>
  );
}

function Inner() {
  const { analysis } = useApp();
  const [decision, setDecision] = useState<DecisionFilter>("all");
  const [status, setStatus] = useState<"all" | BehaviourStatus>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("priority");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("decision");
    if (d === "act" || d === "RECOVER" || d === "UNDERSTAND" || d === "HOLD") setDecision(d);
  }, []);
  useEffect(() => setPage(0), [decision, status, q, sort]);

  const rows = useMemo(() => {
    const list = analysis.profiles.filter((p) => {
      const t = analysis.trials[p.customerId];
      if (decision === "act" && t.decision === "HOLD") return false;
      if (decision !== "all" && decision !== "act" && t.decision !== decision) return false;
      if (status !== "all" && p.status !== status) return false;
      if (q && !p.customerId.toLowerCase().includes(q.toLowerCase().trim())) return false;
      return true;
    });
    const key = (id: string) => {
      const p = analysis.byId[id];
      switch (sort) {
        case "priority": return -analysis.trials[id].priorityScore;
        case "overdue": return -(p.overdueRatio ?? -1);
        case "recency": return -p.recencyDays;
        case "spend": return -p.totalSpend;
        default: return 0;
      }
    };
    return list.sort((a, b) => key(a.customerId) - key(b.customerId) || a.customerId.localeCompare(b.customerId));
  }, [analysis, decision, status, q, sort]);

  const c = analysis.counts;
  const pages = Math.ceil(rows.length / PAGE);
  const filtered = decision !== "all" || status !== "all" || q !== "";

  return (
    <>
      <PageHeader title="Customer Directory" subtitle="Every customer, compared with their own usual buying pattern. Open a case to see the evidence." />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="relative">
            <span className="sr-only">Search customer ID</span>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID" className="h-9 w-36 rounded-md border border-line-strong bg-surface pl-8 pr-2 text-sm text-ink placeholder:text-ink-faint" />
          </label>
          <Segmented<DecisionFilter>
            label="Decision"
            value={decision}
            onChange={setDecision}
            options={[
              { value: "all", label: "All", count: analysis.profiles.length },
              { value: "act", label: "Needs action", count: c.RECOVER + c.UNDERSTAND },
              { value: "RECOVER", label: "Recover", count: c.RECOVER },
              { value: "UNDERSTAND", label: "Understand", count: c.UNDERSTAND },
              { value: "HOLD", label: "Hold", count: c.HOLD },
            ]}
          />
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selectCls}>
            <option value="all">Any status</option>
            {(Object.keys(STATUS_LABEL) as BehaviourStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectCls}>
            <option value="priority">Sort: priority</option>
            <option value="overdue">Sort: most overdue</option>
            <option value="recency">Sort: longest since purchase</option>
            <option value="spend">Sort: total spend</option>
            <option value="id">Sort: ID</option>
          </select>
          {filtered && <Button size="sm" variant="ghost" onClick={() => { setDecision("all"); setStatus("all"); setQ(""); }}>Clear</Button>}
        </div>
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState title="No customers match">Try clearing the filters.</EmptyState></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Customer</th>
                    <th className={th}>Status</th>
                    <th className={th}>Main signal</th>
                    <th className={th}>Recommended action</th>
                    <th className={th}><span className="sr-only">View case</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(page * PAGE, page * PAGE + PAGE).map((p) => {
                    const t = analysis.trials[p.customerId];
                    return (
                      <tr key={p.customerId} className={trHover}>
                        <td className={`${td} font-medium`}>
                          <Link href={`/insights?id=${p.customerId}`} className="text-ink hover:text-plum-accent">{p.customerId}</Link>
                          {p.openServiceIssue && <span className="ml-2"><Tag tone="red">Complaint</Tag></span>}
                        </td>
                        <td className={td}><StatusBadge s={p.status} /></td>
                        <td className={`${td} text-ink-soft`}>{signalText(p)}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          <DecisionBadge d={t.decision} />
                          <span className="ml-2 text-ink-soft">{t.decision === "HOLD" ? holdReason(t) : ACTION_VERB[t.recommendedAction]}</span>
                        </td>
                        <td className={`${td} text-right`}><ButtonLink href={`/insights?id=${p.customerId}`} size="sm">View case</ButtonLink></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line">
              <Pager page={page} pages={pages} onPage={setPage} total={rows.length} label="customers" />
            </div>
          </>
        )}
      </Card>
    </>
  );
}
