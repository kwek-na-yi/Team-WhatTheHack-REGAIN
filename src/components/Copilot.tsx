"use client";
// REGAIN Decision Copilot — a side panel that answers questions from the engine's own results.
// Answers are computed in the browser by lib/copilot (deterministic). If the user turns it on and a key is
// configured, only redacted, verified facts are sent to /api/copilot for rewording; the numbers shown in
// the evidence cards always come from the engine. Nothing here changes saved state except the explicit,
// two-step "save assumptions" confirmation.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { answerQuestion, MAX_QUESTION, proposalAction, STATEMENT_LABEL, suggestedPrompts, type AssumptionProposal, type ComparisonRow, type CopilotAnswer, type CopilotLink, type CustomerCard, type ExperimentSummary, type StatementKind } from "@/lib/copilot";
import { buildModelFacts, restoreIds, validateModelText } from "@/lib/copilotGuard";
import { ACTION_SHORT } from "@/lib/present";
import { fmtMoney, fmtPct, fmtPp } from "@/lib/utils";
import { now, OPEN_CUSTOMER_EVENT, useApp } from "./AppProvider";
import { Button, DecisionBadge, Icon, Notice, Tag, TipText } from "./ui";

interface AiState {
  loading: boolean;
  text?: string;
  note?: string;
}

interface Turn {
  id: number;
  question: string;
  answer: CopilotAnswer | null;
  error?: string;
  ai?: AiState;
}

const KIND_CLS: Record<StatementKind, string> = {
  fact: "text-ink-faint",
  indicator: "text-ink-faint",
  explanation: "italic text-ink-faint",
  unknown: "text-ink-faint",
  estimate: "text-plum-text",
  simulated: "rounded border border-dashed border-plum-accent px-1 text-plum-text",
  rule: "text-info",
  step: "text-plum-text",
};

const signed = (x: number) => (x > 0 ? "+" : "") + fmtMoney(x, 2);
const valueCls = (x: number) => (x > 0.005 ? "text-good" : x < -0.005 ? "text-crimson-text" : "text-ink");

/** Customer whose case the current page shows: the /customers/[id] route, else the saved selection. */
function useActiveCustomer(): string | null {
  const path = usePathname();
  const { state, analysis, ready } = useApp();
  if (!ready) return null;
  const m = path.match(/^\/customers\/([^/]+)$/);
  const fromPath = m ? decodeURIComponent(m[1]) : null;
  if (fromPath && analysis.byId[fromPath]) return fromPath;
  return state.selectedCustomerId && analysis.byId[state.selectedCustomerId] ? state.selectedCustomerId : null;
}

export function Copilot() {
  const { state, dispatch, analysis, ready } = useApp();
  const path = usePathname();
  const router = useRouter();
  const active = useActiveCustomer();
  const [open, setOpen] = useState(false);
  const [portfolioOnly, setPortfolioOnly] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const customerId = portfolioOnly ? null : active;
  useEffect(() => {
    setPortfolioOnly(false);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/copilot")
      .then((r) => r.json())
      .then((d: { aiAvailable?: boolean }) => setAiAvailable(d.aiAvailable === true))
      .catch(() => setAiAvailable(false));
    inputRef.current?.focus();
  }, [open]);

  // Block body: some browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const allIds = useMemo(() => analysis.profiles.map((p) => p.customerId), [analysis]);
  const prompts = useMemo(
    () => suggestedPrompts(path, customerId ? { id: customerId, trial: analysis.trials[customerId], profile: analysis.byId[customerId] } : null),
    [path, customerId, analysis],
  );

  if (!ready) return null;

  const close = () => {
    setOpen(false);
    setTimeout(() => launcherRef.current?.focus(), 0);
  };

  const reword = async (turnId: number, answer: CopilotAnswer) => {
    const facts = buildModelFacts(answer, allIds);
    const set = (ai: AiState) => setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, ai } : t)));
    set({ loading: true });
    try {
      const res = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts }), signal: AbortSignal.timeout(15_000) });
      const d = (await res.json()) as { source?: string; text?: unknown; note?: unknown };
      const note = typeof d.note === "string" ? d.note.slice(0, 200) : "AI wording unavailable — REGAIN's own wording is shown.";
      // Re-validate in the browser too: the server is not the only line of defence.
      const v = d.source === "ai" ? validateModelText(d.text, facts) : null;
      set(v?.ok ? { loading: false, text: restoreIds(v.text, answer), note } : { loading: false, note: v && !v.ok ? `AI wording rejected (${v.reason}) — REGAIN's own wording is shown.` : note });
    } catch {
      set({ loading: false, note: "AI provider unreachable — REGAIN's own wording is shown." });
    }
  };

  const ask = (raw: string) => {
    const question = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
    if (!question) return;
    const id = nextId.current++;
    let answer: CopilotAnswer | null = null;
    let error: string | undefined;
    try {
      answer = answerQuestion(question, { state, analysis, customerId });
    } catch {
      error = "Something went wrong while calculating this answer. Nothing was changed. Try rephrasing, or open the relevant page directly.";
    }
    setTurns((ts) => [...ts, { id, question, answer, error }]);
    setInput("");
    if (answer && aiOn && aiAvailable && answer.intent !== "policy_refusal" && answer.intent !== "not_allowed") void reword(id, answer);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  const follow = (l: CopilotLink) => {
    if (l.customerId) dispatch({ type: "SELECT_CUSTOMER", customerId: l.customerId });
    const target = l.href.split(/[?#]/)[0];
    router.push(l.href);
    // The page is already mounted: tell it which customer to show.
    if (l.customerId && target === path) window.dispatchEvent(new CustomEvent(OPEN_CUSTOMER_EVENT, { detail: l.customerId }));
    if (window.innerWidth < 640) close();
  };

  const latest = turns[turns.length - 1];

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-30 inline-flex h-10 items-center gap-2 rounded-full border border-brand bg-brand px-4 text-sm font-medium text-white shadow-lg transition-colors hover:bg-brand-hover"
          aria-haspopup="dialog"
        >
          <Icon name="message" className="h-4 w-4" />
          Ask REGAIN
        </button>
      )}
      {open && (
        <aside
          role="dialog"
          aria-modal="false"
          aria-label="Decision Copilot"
          onKeyDown={(e) => e.key === "Escape" && close()}
          className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-canvas shadow-2xl sm:w-[440px]"
        >
          <header className="border-b border-line bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-ink">Decision Copilot</h2>
                <p className="text-2xs text-ink-muted">Answers from REGAIN&apos;s own data, Recovery Trial and experiments</p>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setTurns([])} disabled={!turns.length} title="Clear this conversation">New chat</Button>
                <button type="button" onClick={close} aria-label="Close Decision Copilot" className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">
                  <Icon name="x" className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
              {customerId ? (
                <>
                  <span className="text-ink-muted">Context</span>
                  <span className="rounded bg-plum px-1.5 py-0.5 font-semibold text-plum-text" data-testid="copilot-context">Customer {customerId}</span>
                  <DecisionBadge d={analysis.trials[customerId].decision} />
                  <button type="button" className="ml-auto text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink" onClick={() => setPortfolioOnly(true)}>
                    Ask about all customers
                  </button>
                </>
              ) : (
                <>
                  <span className="text-ink-muted">Context</span>
                  <span className="rounded bg-surface-3 px-1.5 py-0.5 font-semibold text-ink-soft" data-testid="copilot-context">All customers</span>
                  <span className="text-ink-faint">{active ? "" : "Select a customer for case-specific answers."}</span>
                  {active && (
                    <button type="button" className="ml-auto text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink" onClick={() => setPortfolioOnly(false)}>
                      Back to {active}
                    </button>
                  )}
                </>
              )}
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {!turns.length && (
              <div className="space-y-3">
                <p className="text-sm text-ink-soft">
                  {customerId
                    ? `Ask why REGAIN decided what it did for ${customerId}, compare actions, or try a what-if. Nothing you ask changes saved data.`
                    : "Ask about the whole portfolio, or select a customer to ask about one case. Nothing you ask changes saved data."}
                </p>
                <PromptList prompts={prompts} onAsk={ask} />
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className="space-y-2">
                <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-brand px-3 py-2 text-sm text-white">{t.question}</div>
                {t.error && <Notice tone="error">{t.error}</Notice>}
                {t.answer && <AnswerCard answer={t.answer} ai={t.ai} onLink={follow} />}
              </div>
            ))}
            {latest?.answer && (
              <div>
                <div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-ink-faint">Ask next</div>
                <PromptList prompts={prompts.filter((p) => !turns.some((t) => t.question === p)).slice(0, 3)} onAsk={ask} />
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="sr-only" aria-live="polite">
            {latest?.answer ? `${latest.answer.title}. ${latest.ai?.text ?? latest.answer.summary}` : ""}
          </div>

          <form onSubmit={submit} className="border-t border-line bg-surface px-4 py-3">
            <label htmlFor="copilot-input" className="sr-only">Ask the Decision Copilot</label>
            <div className="flex items-end gap-2">
              <textarea
                id="copilot-input"
                ref={inputRef}
                rows={2}
                maxLength={MAX_QUESTION}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
                placeholder={customerId ? `Ask about ${customerId}…` : "Ask about your customers…"}
                className="min-h-[44px] flex-1 resize-none rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-plum-accent"
              />
              <Button type="submit" variant="primary" disabled={!input.trim()}>Ask</Button>
            </div>
            <div className="mt-2 space-y-1 text-2xs leading-snug text-ink-muted">
              <p>Figures come from REGAIN&apos;s engine using your saved assumptions{path.startsWith("/trial") ? " — unsaved slider changes on this page are not included" : ""}. The Copilot can&apos;t approve or send messages; sends and replies are simulated in this prototype.</p>
              {aiAvailable ? (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={aiOn} onChange={(e) => setAiOn(e.target.checked)} aria-label="Reword answers with AI" />
                  Reword answers with external AI (sends redacted facts only — no IDs, records or CSV)
                </label>
              ) : (
                <p>No AI provider configured — all wording is REGAIN&apos;s deterministic template.</p>
              )}
            </div>
          </form>
        </aside>
      )}
    </>
  );
}

function PromptList({ prompts, onAsk }: { prompts: string[]; onAsk: (q: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Suggested questions">
      {prompts.map((p) => (
        <li key={p}>
          <button type="button" onClick={() => onAsk(p)} className="rounded-full border border-line-strong bg-surface px-2.5 py-1 text-left text-xs text-ink-soft transition-colors hover:border-plum-accent hover:text-ink">
            {p}
          </button>
        </li>
      ))}
    </ul>
  );
}

function AnswerCard({ answer: a, ai, onLink }: { answer: CopilotAnswer; ai?: AiState; onLink: (l: CopilotLink) => void }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const aiText = ai?.text && !showOriginal ? ai.text : null;
  return (
    <article className="rounded-lg rounded-bl-sm border border-line bg-surface p-3.5 shadow-card" aria-label={a.title} data-intent={a.intent}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{a.title}</h3>
        {a.customerId && <span className="text-2xs font-medium text-ink-muted">{a.customerId}</span>}
        <span className="ml-auto">
          {ai?.text ? (
            <Tag tone="plum" title="Wording from an external AI model, checked against REGAIN's facts. Numbers in the cards below come from the engine.">AI-worded · checked</Tag>
          ) : (
            <Tag tone="outline" title="Computed and worded by REGAIN's deterministic engine.">REGAIN engine</Tag>
          )}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft" data-testid="copilot-summary">{aiText ?? a.summary}</p>
      {ai?.loading && <p className="mt-1 text-2xs text-ink-muted" role="status">Rewording with AI…</p>}
      {ai && !ai.loading && (
        <p className="mt-1 text-2xs text-ink-muted">
          {ai.note}
          {ai.text && (
            <button type="button" className="ml-1 underline underline-offset-2 hover:text-ink" onClick={() => setShowOriginal((s) => !s)}>
              {showOriginal ? "Show AI wording" : "Show REGAIN's wording"}
            </button>
          )}
        </p>
      )}

      {a.statements.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-2.5">
          {a.statements.map((s, i) => (
            <li key={i} className="text-xs leading-snug text-ink-soft">
              <span className={`mr-1.5 inline-flex whitespace-nowrap text-2xs font-semibold uppercase tracking-wider ${KIND_CLS[s.kind]}`}>{STATEMENT_LABEL[s.kind]}</span>
              {s.text}
            </li>
          ))}
        </ul>
      )}

      {a.comparison && <Comparison rows={a.comparison.rows} hypothetical={a.comparison.hypothetical} changes={a.comparison.changes} />}
      {a.customers && <Customers cards={a.customers.cards} total={a.customers.total} onLink={onLink} />}
      {a.experiment && <Experiment e={a.experiment} />}
      {a.proposal && <Proposal proposal={a.proposal} />}

      {a.links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
          {a.links.map((l) => (
            <button key={l.href + l.label} type="button" onClick={() => onLink(l)} className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-2" data-href={l.href}>
              {l.label}
              <Icon name="chevron" className="h-3 w-3 text-ink-faint" />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function Comparison({ rows, hypothetical, changes }: { rows: ComparisonRow[]; hypothetical: boolean; changes: string[] }) {
  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">Recovery Trial · vs doing nothing</span>
        {hypothetical && <Tag tone="plum">What-if · not saved</Tag>}
      </div>
      {hypothetical && changes.length > 0 && (
        <ul className="mb-2 list-disc space-y-0.5 pl-4 text-xs text-ink-soft">
          {changes.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line" aria-label="Action comparison">
        {rows.map((r) => (
          <li key={r.action} className={`px-2.5 py-2 ${r.recommended ? "bg-plum" : "bg-surface"}`}>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-ink">{r.label}</span>
              {r.recommended && <Tag tone="outline">Recommended</Tag>}
              {!r.eligible && <Tag tone="red">Not eligible</Tag>}
              {r.dependsOnAssumptions && r.eligible && <span className="text-2xs italic text-ink-faint"><TipText text="The effect of this action is an editable assumption until a randomised test measures it.">assumed effect</TipText></span>}
            </div>
            {r.eligible && (
              <div className="mt-0.5 text-xs tabular-nums text-ink-soft">
                {r.action === "no_action" ? (
                  <span>Baseline · no cost</span>
                ) : (
                  <>
                    <span className={`font-semibold ${valueCls(r.incremental)}`}>{signed(r.incremental)}</span> <span className="text-ink-muted">est. extra contribution</span>
                    <span className="text-ink-muted"> · range {fmtMoney(r.low, 2)} to {fmtMoney(r.high, 2)} · cost {fmtMoney(r.cost, 2)}</span>
                    {r.savedIncremental !== undefined && Math.abs(r.savedIncremental - r.incremental) > 0.005 && <span className="text-ink-muted"> · saved: {signed(r.savedIncremental)}</span>}
                  </>
                )}
              </div>
            )}
            {r.reason && <div className="mt-0.5 text-2xs leading-snug text-ink-muted">{r.reason}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Customers({ cards, total, onLink }: { cards: CustomerCard[]; total: number; onLink: (l: CopilotLink) => void }) {
  if (!cards.length) return <p className="mt-3 border-t border-line pt-2.5 text-xs text-ink-muted">No matching customers.</p>;
  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
        {total} matching · showing {cards.length}
      </div>
      <ul className="space-y-1.5" aria-label="Matching customers">
        {cards.map((c) => (
          <li key={c.customerId} className="rounded-md border border-line px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-ink">{c.customerId}</span>
              <DecisionBadge d={c.decision} />
              <span className="text-ink-muted">· {ACTION_SHORT[c.action]}</span>
              {c.value !== null && <span className={`ml-auto tabular-nums font-semibold ${valueCls(c.value)}`}><TipText text="Estimated incremental contribution of the recommended action.">{`${signed(c.value)} est.`}</TipText></span>}
            </div>
            <div className="mt-0.5 text-2xs text-ink-muted">{c.signal}</div>
            <div className="mt-0.5 text-2xs leading-snug text-ink-soft">{c.reason}</div>
            <button
              type="button"
              onClick={() => onLink({ label: "Open case", href: c.decision === "HOLD" ? `/insights?id=${c.customerId}` : `/trial?id=${c.customerId}`, customerId: c.customerId })}
              className="mt-1 text-2xs font-medium text-plum-text underline decoration-line-strong underline-offset-4 hover:decoration-plum-accent"
              aria-label={`Open case ${c.customerId}`}
            >
              Open case — {c.decision === "HOLD" ? "Customer Insights" : "Recovery Decisions"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VERDICT: Record<ExperimentSummary["verdict"], { label: string; tone: "green" | "red" | "neutral" | "outline" }> = {
  positive: { label: "Interval above zero", tone: "green" },
  negative: { label: "Interval below zero", tone: "red" },
  inconclusive: { label: "Inconclusive", tone: "neutral" },
  no_data: { label: "No outcomes yet", tone: "outline" },
};
const EVIDENCE: Record<ExperimentSummary["evidence"], string> = {
  simulated: "Simulated outcomes",
  randomised: "Randomised holdout",
  observed_unverified: "Imported · assignment not verified",
  pending: "Awaiting outcomes",
};

function Experiment({ e }: { e: ExperimentSummary }) {
  const cells: [string, string][] = [
    ["Treatment", `${fmtPct(e.treatment.rate, 1)} (${e.treatment.purchases}/${e.treatment.n})`],
    ["Control", `${fmtPct(e.control.rate, 1)} (${e.control.purchases}/${e.control.n})`],
    ["Difference", fmtPp(e.diffPp)],
    ["95% interval", `${fmtPp(e.ci[0])} to ${fmtPp(e.ci[1])}`],
  ];
  if (e.pValue !== null) cells.push(["p-value", e.pValue.toFixed(3)]);
  if (e.incrementalContribution !== null) cells.push([e.evidence === "simulated" ? "Contribution (simulated)" : "Est. contribution", fmtMoney(e.incrementalContribution, 2)]);
  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-ink">{e.title}</span>
        <Tag tone={VERDICT[e.verdict].tone}>{VERDICT[e.verdict].label}</Tag>
        <span className={`text-2xs font-medium uppercase tracking-wider ${e.evidence === "simulated" ? "rounded border border-dashed border-plum-accent px-1 text-plum-text" : "text-ink-faint"}`}>{EVIDENCE[e.evidence]}</span>
        {e.syntheticData && <span className="text-2xs font-medium uppercase tracking-wider text-ink-faint">Synthetic data</span>}
      </div>
      {e.verdict !== "no_data" && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line text-xs">
          {cells.map(([k, v]) => (
            <div key={k} className="bg-surface px-2.5 py-1.5">
              <dt className="text-2xs text-ink-muted">{k}</dt>
              <dd className="font-semibold tabular-nums text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Proposal({ proposal }: { proposal: AssumptionProposal }) {
  const { state, dispatch } = useApp();
  const [step, setStep] = useState<"idle" | "confirm" | "saved" | "stale">("idle");
  const save = () => {
    const action = proposalAction(proposal, state.assumptions, now());
    if (!action) return setStep("stale");
    dispatch(action);
    setStep("saved");
  };
  return (
    <div className="mt-3 rounded-md border border-dashed border-line-strong bg-surface-2 px-2.5 py-2">
      {step === "saved" ? (
        <Notice tone="success">Saved. Every customer is now analysed with these assumptions, and the change is in the audit trail. You can reset them in Recovery Decisions.</Notice>
      ) : step === "stale" ? (
        <Notice tone="error">Your saved assumptions changed since this preview was calculated, so nothing was saved. Ask the question again for a fresh preview.</Notice>
      ) : step === "confirm" ? (
        <div className="space-y-2 text-xs text-ink-soft">
          <p>
            <span className="font-semibold text-ink">Confirm:</span> save {proposal.changes.join("; ")} as your assumptions for <em>all</em> customers? {proposal.decisionsChanged} customer{proposal.decisionsChanged === 1 ? "'s" : "s'"} decision or action would change. Consent, opt-out and contact limits are not affected.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={save}>Confirm and save</Button>
            <Button size="sm" variant="ghost" onClick={() => setStep("idle")}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
          <span>This what-if is not saved. {proposal.decisionsChanged} decision{proposal.decisionsChanged === 1 ? "" : "s"} across the portfolio would change if you saved it.</span>
          <Button size="sm" onClick={() => setStep("confirm")}>Save as my assumptions…</Button>
        </div>
      )}
    </div>
  );
}
