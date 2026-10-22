"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { now, useApp, useQueryId } from "@/components/AppProvider";
import { CaseBar } from "@/components/CaseBar";
import { Button, ButtonLink, Card, CustomerPicker, DataGate, DecisionBadge, EmptyState, Notice, PageHeader, selectCls, Source, StatusBadge, Tag, TextLink } from "@/components/ui";
import {
  checkClaims,
  contextFromProfile,
  conversationReducer,
  draftMessage,
  initConversation,
  STATUS_LABEL,
  type Channel,
  type ConvEvent,
  type ConversationState,
  type ResponseKind,
  type Tone,
} from "@/lib/conversation";
import { ACTION_VERB, mainReason } from "@/lib/present";
import { ACTION_LABEL } from "@/lib/trial";
import type { ActionId } from "@/lib/types";

export default function StudioPage() {
  return (
    <DataGate>
      <Inner />
    </DataGate>
  );
}

const RESPONSES: { kind: ResponseKind; label: string }[] = [
  { kind: "interested", label: "Interested in returning" },
  { kind: "not_interested", label: "Not interested" },
  { kind: "service_problem", label: "Has a service problem" },
  { kind: "needs_info", label: "Needs more information" },
];
const EDITABLE = new Set(["draft", "rejected", "positive", "declined", "service_issue", "info_requested"]);
type StepState = "done" | "current" | "upcoming";

/** One step of the workflow. Steps share a single container; the current one gets a thin plum rule. */
function Step({ n, title, state, children, aside }: { n: number; title: string; state: StepState; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`border-l-2 ${state === "current" ? "border-l-plum-accent" : "border-l-transparent"}`} aria-current={state === "current" ? "step" : undefined}>
      <div className="flex items-baseline gap-3 px-5 pt-5">
        <span className={`w-4 shrink-0 text-sm tabular-nums ${state === "upcoming" ? "text-ink-faint" : "text-ink-muted"}`}>{n}</span>
        <h2 className={`text-[15px] font-medium ${state === "upcoming" ? "text-ink-faint" : "text-ink"}`}>{title}</h2>
        {state === "done" && <span className="text-xs text-ink-faint">Done</span>}
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <div className="px-5 pb-5 pl-12 pt-3">{children}</div>
    </section>
  );
}

const SOURCE_LABEL = { template: "Generated from the customer's records", ai: "AI draft (external) — review carefully", edited: "Edited by you" } as const;

function Inner() {
  const { state, dispatch, analysis } = useApp();
  const qid = useQueryId();
  const [id, setId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [tone, setTone] = useState<Tone>(state.tone);
  const [channel, setChannel] = useState<Channel>(state.channel);
  const [reviewed, setReviewed] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [ai, setAi] = useState<{ available: boolean; loading: boolean; note?: string }>({ available: false, loading: false });

  useEffect(() => {
    fetch("/api/generate-message")
      .then((r) => r.json())
      .then((d: { aiAvailable: boolean }) => setAi((a) => ({ ...a, available: d.aiAvailable })))
      .catch(() => setAi((a) => ({ ...a, available: false })));
  }, []);

  useEffect(() => {
    const ok = (x?: string | null) => !!x && !!analysis.byId[x];
    const pick = ok(qid) ? qid : ok(state.selectedCustomerId) ? (state.selectedCustomerId as string) : null;
    setId(pick);
    if (pick && pick !== state.selectedCustomerId) dispatch({ type: "SELECT_CUSTOMER", customerId: pick });
  }, [qid]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = id ? analysis.byId[id] : undefined;
  const trial = id ? analysis.trials[id] : undefined;
  const conv: ConversationState | undefined = id ? state.conversations[id] : undefined;
  const action: ActionId = conv?.action ?? trial?.recommendedAction ?? "check_in";

  const ctx = useMemo(
    () =>
      p && trial
        ? contextFromProfile(p, { businessName: state.businessName, tone, channel, action: action === "no_action" ? "check_in" : action, decision: trial.decision, discountRate: state.assumptions.actions.discount.discountRate, benefitDescription: state.benefitDescription })
        : null,
    [p, trial, state.businessName, tone, channel, action, state.assumptions, state.benefitDescription],
  );
  const claimsCtx = ctx ? { action: ctx.action, channel: ctx.channel, issue: ctx.issue ?? (conv?.lastResponse === "service_problem" ? { date: "reply", issue: "reported in reply" } : undefined) } : null;
  const warnings = conv && claimsCtx && conv.draft ? checkClaims(conv.draft, claimsCtx) : [];

  const choose = (cid: string) => {
    setId(cid);
    setReviewed(false);
    dispatch({ type: "SELECT_CUSTOMER", customerId: cid });
    window.history.replaceState(null, "", `/studio?id=${cid}`);
  };
  const top = Object.values(analysis.trials).filter((t) => t.decision !== "HOLD").sort((a, b) => b.priorityScore - a.priorityScore)[0];
  const picker = (
    <>
      <label className="flex items-center gap-1.5 text-sm text-ink-muted">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include customers on hold
      </label>
      <CustomerPicker value={id} onChange={choose} filter={(cid) => showAll || analysis.trials[cid].decision !== "HOLD" || !!state.conversations[cid]} />
    </>
  );

  if (!p || !trial || !ctx)
    return (
      <>
        <PageHeader title="Conversation Studio" subtitle="Write, approve and test the message. Nothing is ever sent." actions={picker} />
        <EmptyState title="Choose a customer to begin a recovery conversation." action={top && <Button variant="primary" onClick={() => choose(top.customerId)}>Start with the top priority ({top.customerId})</Button>}>
          Or pick any customer from the list above.
        </EmptyState>
      </>
    );

  const send = (e: ConvEvent) => {
    if (!conv) return;
    const next = conversationReducer(conv, e);
    dispatch({ type: "SAVE_CONVERSATION", conv: next });
    return next;
  };
  const start = (overrideHold = false) => {
    const a: ActionId = trial.recommendedAction === "no_action" ? "check_in" : trial.recommendedAction;
    dispatch({ type: "SAVE_CONVERSATION", conv: initConversation(p.customerId, a, draftMessage({ ...ctx, action: a })) });
    if (overrideHold) dispatch({ type: "AUDIT", entry: { at: now(), type: "decision_viewed", customerId: p.customerId, detail: `User overrode HOLD (${trial.headline}) to draft a check-in. Override recorded.` } });
  };
  const regenerate = () => send({ type: "SET_DRAFT", text: draftMessage({ ...ctx, action: conv?.action === "no_action" ? "check_in" : (conv?.action ?? "check_in") }), source: "template" });
  const draftWithAi = async () => {
    setAi((a) => ({ ...a, loading: true, note: undefined }));
    try {
      const r = await fetch("/api/generate-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: ctx }) });
      const d = (await r.json()) as { source: "ai" | "template"; text: string; note: string; error?: string };
      if (d.error) throw new Error(d.error);
      send({ type: "SET_DRAFT", text: d.text, source: d.source });
      setAi((a) => ({ ...a, loading: false, note: d.note }));
    } catch (e) {
      setAi((a) => ({ ...a, loading: false, note: `Request failed: ${e instanceof Error ? e.message : "unknown error"}. The current draft was kept.` }));
    }
  };
  const approve = () => {
    if (!conv) return;
    const wasInitial = conv.status === "draft";
    const next = send({ type: "APPROVE", reviewed, warnings });
    if (next && !next.error) {
      setReviewed(false);
      if (wasInitial) dispatch({ type: "RECORD_SEND", customerId: p.customerId, action: conv.action, at: now(), detail: `Approved & simulated send of ${ACTION_LABEL[conv.action]} (${conv.draftSource} draft, ${channel}). Counts toward frequency cap.` });
      else dispatch({ type: "AUDIT", entry: { at: now(), type: "message_approved", customerId: p.customerId, detail: `Approved follow-up reply (${STATUS_LABEL[conv.status]}). Simulated — not sent.` } });
    }
  };
  const reject = () => {
    const next = send({ type: "REJECT", reason: rejectReason.trim() });
    if (next && !next.error) {
      dispatch({ type: "AUDIT", entry: { at: now(), type: "message_rejected", customerId: p.customerId, detail: `Draft rejected: ${rejectReason.trim() || "no reason given"}.` } });
      setRejectReason("");
    }
  };
  const respond = (kind: ResponseKind) => {
    const next = send({ type: "RESPOND", kind, ctx });
    if (!next || next.error) return;
    dispatch({ type: "AUDIT", entry: { at: now(), type: "response_simulated", customerId: p.customerId, detail: `Simulated customer response: ${kind.replace("_", " ")}. Next step: ${next.next.title}.` } });
    if (kind === "not_interested") dispatch({ type: "SUPPRESS", customerId: p.customerId, days: 90, at: now() });
  };
  const resetConv = () => {
    const { [p.customerId]: _drop, ...rest } = state.conversations; // eslint-disable-line @typescript-eslint/no-unused-vars
    dispatch({ type: "HYDRATE", state: { ...state, conversations: rest } });
  };

  const blocked = !!trial.suppression && !conv;
  const editable = !!conv && EDITABLE.has(conv.status);
  const finished = conv?.status === "closed" || conv?.status === "escalated";
  // 1 context · 2 edit · 3 approve · 4 reply · 5 next action
  const step = !conv ? 1 : editable ? 2 : conv.status === "awaiting_response" ? 4 : 5;
  const st = (n: number): StepState => (n === 3 ? (step > 3 ? "done" : step === 2 ? "current" : "upcoming") : step > n ? "done" : step === n ? "current" : "upcoming");
  const isFollowUp = !!conv && conv.status !== "draft" && conv.status !== "rejected";

  return (
    <>
      <PageHeader title="Conversation Studio" subtitle="Write, approve and test the message. Nothing is ever sent." actions={picker} />
      <CaseBar customerId={p.customerId} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <Step n={1} title="Review customer context" state={st(1)} aside={<TextLink href={`/trial?id=${p.customerId}`}>Why this action?</TextLink>}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-ink">{p.customerId}</span>
              <StatusBadge s={p.status} />
              {conv ? <Tag tone="plum">In progress</Tag> : <DecisionBadge d={trial.decision} />}
              <span className="text-sm font-semibold text-ink">{ACTION_VERB[conv?.action ?? trial.recommendedAction]}</span>
            </div>
            <p className="mt-1.5 text-sm text-ink-soft">
              {conv && conv.sends > 0 && trial.suppression === "frequency_cap"
                ? "This conversation counts as a contact, so REGAIN now holds any new outreach to this customer until the contact limit allows it."
                : mainReason(trial)}
            </p>
            {!conv && (
              <div className="mt-4">
                {blocked ? (
                  <Notice tone="error">Contact not permitted. REGAIN won&apos;t draft a message for this customer.</Notice>
                ) : trial.decision === "HOLD" ? (
                  <div className="space-y-3">
                    <Notice tone="info">REGAIN recommends doing nothing for now. You can still override — the override is logged.</Notice>
                    <Button onClick={() => start(true)}>Override and write a check-in</Button>
                  </div>
                ) : (
                  <Button variant="primary" onClick={() => start(false)}>Generate message</Button>
                )}
              </div>
            )}
          </Step>

          <Step n={2} title={isFollowUp && editable ? "Review and edit the reply" : "Review and edit the message"} state={st(2)} aside={conv && <Tag tone={conv.status === "rejected" ? "red" : finished ? "green" : conv.sends > 0 ? "plum" : "outline"}>{STATUS_LABEL[conv.status]}</Tag>}>
            {!conv ? (
              <p className="text-sm text-ink-muted">Generate a message to review it here.</p>
            ) : (
              <div className="space-y-4">
                {conv.messages.length > 0 && (
                  <div className="space-y-3 rounded-md border border-line bg-canvas p-4" aria-label="Conversation so far">
                    {conv.messages.map((m, i) =>
                      m.from === "system" ? (
                        <div key={i} className={`text-center text-xs ${m.text.startsWith("Draft rejected") ? "text-crimson-text" : "text-ink-muted"}`}>{m.text}</div>
                      ) : (
                        <div key={i} className={`flex ${m.from === "business" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.from === "business" ? "rounded-br-sm bg-plum text-ink" : "rounded-bl-sm border border-line-strong bg-surface-2 text-ink"}`}>
                            {m.text}
                            <div className={`mt-1.5 flex items-center gap-1.5 text-2xs ${m.from === "business" ? "text-ink-muted" : "text-ink-muted"}`}>
                              {m.from === "business" ? "You · approved · not actually sent" : <>Customer reply · <Source kind="simulated" /></>}
                            </div>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
                {editable && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                        <span className={`h-1.5 w-1.5 rounded-full ${conv.draftSource === "edited" ? "bg-ink" : "bg-plum-accent"}`} aria-hidden="true" />
                        {SOURCE_LABEL[conv.draftSource]}
                      </span>
                      {(conv.status === "draft" || conv.status === "rejected") && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={regenerate}>Regenerate message</Button>
                          <Button size="sm" onClick={draftWithAi} disabled={!ai.available || ai.loading} title={ai.available ? "Uses the optional server-side AI integration" : "No AI provider configured. The template works without one."}>
                            {ai.loading ? "Drafting…" : "Draft with AI"}
                          </Button>
                        </div>
                      )}
                    </div>
                    <textarea
                      aria-label="Message draft"
                      className="h-48 w-full rounded-md border border-line-strong bg-surface p-3 text-sm leading-relaxed text-ink transition-colors focus:border-ink-faint"
                      value={conv.draft}
                      onChange={(e) => send({ type: "SET_DRAFT", text: e.target.value, source: "edited" })}
                    />
                    {ai.note && <Notice tone="info">{ai.note}</Notice>}
                    <div className="space-y-1" aria-live="polite">
                      {warnings.length === 0 ? (
                        <div className="text-sm text-good">Claims check passed — every statement matches the customer&apos;s record.</div>
                      ) : (
                        warnings.map((w, i) => (
                          <div key={i} className={`flex items-start gap-1.5 text-sm ${w.severity === "block" ? "text-crimson-text" : "text-ink-soft"}`}>
                            {w.severity === "block" ? "Must fix: " : "Check: "}{w.message}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
                {conv.error && <Notice tone="error">{conv.error}</Notice>}
              </div>
            )}
          </Step>

          <Step n={3} title="Approve or reject" state={st(3)}>
            {editable ? (
              <div className="space-y-3">
                <label className="flex items-start gap-2 text-sm text-ink-soft">
                  <input type="checkbox" className="mt-1" aria-label="I have reviewed this message" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                  I&apos;ve checked every statement against the customer&apos;s record.
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={approve} disabled={!reviewed || warnings.some((w) => w.severity === "block")}>Approve draft</Button>
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why reject? (optional)" className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint" aria-label="Rejection reason" />
                  <Button variant="danger" onClick={reject}>Reject draft</Button>
                </div>
                <p className="text-xs text-ink-muted">Approving records a simulated send. It counts towards the contact limit. Nothing leaves REGAIN.</p>
              </div>
            ) : conv ? (
              <p className="text-sm text-ink-soft">{conv.sends > 0 ? `Approved ${conv.sends} message${conv.sends > 1 ? "s" : ""} — simulated, not sent.` : "Waiting for a decision."}</p>
            ) : (
              <p className="text-sm text-ink-muted">Available once a message is generated.</p>
            )}
          </Step>

          <Step n={4} title="Simulate customer response" state={st(4)} aside={<Source kind="simulated" />}>
            {conv?.status === "awaiting_response" ? (
              <div className="flex flex-wrap gap-2">
                {RESPONSES.map((r) => <Button key={r.kind} onClick={() => respond(r.kind)}>{r.label}</Button>)}
              </div>
            ) : step > 4 ? (
              <p className="text-sm text-ink-soft">Simulated reply recorded{conv?.lastResponse ? `: ${RESPONSES.find((r) => r.kind === conv.lastResponse)?.label.toLowerCase()}` : ""}.</p>
            ) : (
              <p className="text-sm text-ink-muted">Approve a message to see how a customer reply changes the next step.</p>
            )}
          </Step>

          <Step n={5} title="Next recommended action" state={finished ? "done" : st(5)}>
            {conv && step === 5 ? (
              <>
                <div className="text-sm font-semibold text-ink">{conv.next.title}</div>
                <p className="mt-1 text-sm text-ink-soft">{conv.next.detail}</p>
                {conv.status === "declined" && <div className="mt-3"><Notice tone="warn">Contact paused for 90 days. No incentive will be offered.</Notice></div>}
                {conv.status === "service_issue" && <div className="mt-3"><Notice tone="warn">Switched to service recovery. Promotions are paused.</Notice></div>}
                {finished && <div className="mt-3"><ButtonLink href="/impact" size="sm">View results</ButtonLink></div>}
              </>
            ) : (
              <p className="text-sm text-ink-muted">{conv ? conv.next.title : "Shown after the customer's reply."}</p>
            )}
          </Step>
        </div>

        <aside className="space-y-4">
          <Card title="Message settings">
            <div className="space-y-3 text-sm text-ink-soft">
              <label className="flex items-center justify-between gap-2">Tone
                <select className={selectCls} value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                  <option value="warm">Warm</option><option value="professional">Professional</option><option value="concise">Concise</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">Channel
                <select className={selectCls} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                  <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <p className="text-xs text-ink-muted">Applies when you regenerate.</p>
            </div>
          </Card>
          <Card title="What the message may say">
            <dl className="space-y-2.5 text-sm">
              <div><dt className="flex items-center gap-1.5 text-xs text-ink-muted">Last purchase <Source kind="observed" /></dt><dd className="text-ink">{p.lastOrderDate} · {p.recencyDays} days ago</dd></div>
              <div><dt className="flex items-center gap-1.5 text-xs text-ink-muted">Usual gap <Source kind="calculated" /></dt><dd className="text-ink">{ctx.usualInterval ? `${ctx.usualInterval} days` : "Not established — won't be mentioned"}</dd></div>
              <div><dt className="text-xs text-ink-muted">Main category</dt><dd className="text-ink">{p.topCategory}</dd></div>
              <div><dt className="text-xs text-ink-muted">Complaint on record</dt><dd className={p.openServiceIssue ? "text-crimson-text" : "text-ink"}>{p.openServiceIssue ? p.openServiceIssue.issue : "None — no apology allowed"}</dd></div>
              <div><dt className="text-xs text-ink-muted">Name</dt><dd className="text-ink">Not stored · <code className="text-xs text-ink">{"{first_name}"}</code> filled in by your own system</dd></div>
            </dl>
          </Card>
          {conv && <Button size="sm" variant="ghost" onClick={resetConv}>Reset this conversation</Button>}
        </aside>
      </div>
    </>
  );
}
