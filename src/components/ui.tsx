"use client";
// Shared design-system components (light theme). Hierarchy comes from typography and spacing;
// colour is reserved for brand actions and selection (plum), risk (crimson) and success (green).
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/behaviour";
import type { BehaviourStatus, Decision } from "@/lib/types";
import { useApp } from "./AppProvider";

/* ------------------------------------------------------------------ icons */
// One line-icon family (24px grid, 1.75 stroke). Used for navigation and familiar actions only.

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6m13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  chart: "M3 3v18h18M7 15l4-4 3 3 5-6",
  scale: "M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zm14 0-3 7a3 3 0 0 0 6 0z",
  message: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12",
  route: "M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16",
  flask: "M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 14h9",
  database: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3m-8-3v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10m-3-10 2 2 4-4",
  chevron: "m9 6 6 6-6 6",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20m0-6v-4m0-4h.01",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 21h16",
  upload: "M12 21V9m0 0-4 4m4-4 4 4M4 3h16",
  search: "m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14",
  menu: "M4 6h16M4 12h16M4 18h16",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ----------------------------------------------------------------- layout */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Primary content container. `quiet` drops the border for secondary content. */
export function Card({ title, children, className = "", right, padded = true, subtitle, quiet = false }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; right?: ReactNode; padded?: boolean; quiet?: boolean }) {
  return (
    <section className={`rounded-lg bg-surface ${quiet ? "" : "border border-line shadow-card"} ${className}`}>
      {(title || right) && (
        <div className={`flex flex-wrap items-center justify-between gap-2 ${padded ? "px-5 pt-4" : "px-5 py-4"}`}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      <div className={padded ? "px-5 pb-5 pt-3" : ""}>{children}</div>
    </section>
  );
}

/** A row of metrics inside one container, separated by hairlines rather than separate cards. */
export function StatGroup({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const c = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-3 xl:grid-cols-6" }[cols];
  return <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card ${c}`}>{children}</div>;
}

/** Metric: label, one strong number, optional context. Place inside a StatGroup. */
export function Stat({ label, value, hint, tone, tip, tag }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad"; tip?: string; tag?: ReactNode }) {
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-crimson-text" : "text-ink";
  return (
    <div className="bg-surface px-5 py-4">
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        {tip ? <TipText text={tip}>{label}</TipText> : label}
        {tag && <span className="ml-auto">{tag}</span>}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}
export const Kpi = Stat;

const TIP_W = 256;

/**
 * Small info icon with a definition. Hovering (mouse) or focusing (keyboard) shows it while the pointer
 * or focus stays on the icon; clicking or tapping pins it open until the icon is clicked again, the
 * user clicks elsewhere, presses Escape or scrolls. Positioned against the viewport so it is never
 * clipped by a scrolling table or the screen edge.
 */
export function InfoTip({ text, label = "What does this mean?" }: { text: string; label?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const open = hover || pinned;

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - TIP_W / 2), window.innerWidth - TIP_W - 8);
    const above = r.bottom + 140 > window.innerHeight && r.top > 140;
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setHover(false);
      setPinned(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!btn.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!text) return null;
  return (
    <span className="inline-flex shrink-0 align-middle">
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={(e) => {
          // Inside a <summary> or link, the icon must not also toggle the section or navigate.
          e.preventDefault();
          e.stopPropagation();
          if (pinned) {
            setPinned(false);
            setHover(false);
          } else setPinned(true);
        }}
        className={`rounded-full p-0.5 transition-colors hover:text-plum-text ${open ? "text-plum-text" : "text-ink-faint"}`}
      >
        <Icon name="info" className="h-3.5 w-3.5" />
      </button>
      {open && pos && (
        <span
          id={id}
          role="tooltip"
          style={{ left: pos.left, top: pos.top, width: TIP_W, transform: pos.above ? "translateY(-100%)" : undefined }}
          className="tip-in pointer-events-none fixed z-50 rounded-md bg-ink px-2.5 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** A term followed by a small info icon that reveals its definition (see InfoTip). */
export function TipText({ text, children, label }: { text: string; children: ReactNode; label?: string }) {
  if (!text) return <>{children}</>;
  // Inline flow (not flex) so the icon sits right after the last word, even when the term wraps.
  return (
    <span>
      {children}
      <span className="ml-1 inline-flex align-[-2px]">
        <InfoTip text={text} label={label ?? (typeof children === "string" ? `What does “${children}” mean?` : undefined)} />
      </span>
    </span>
  );
}

/** Progressive disclosure on <details>. Inside a DisclosureGroup it renders flush, without its own border. */
export function Disclosure({ title, hint, children, defaultOpen = false, className = "", flush = false }: { title: ReactNode; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string; flush?: boolean }) {
  return (
    <details open={defaultOpen} className={`group ${flush ? "" : "rounded-lg border border-line bg-surface"} ${className}`}>
      <summary className="flex items-center gap-2 px-5 py-3.5 transition-colors hover:bg-surface-2">
        <Icon name="chevron" className="chev h-4 w-4 text-ink-faint transition-transform duration-150" />
        <span className="text-sm font-medium text-ink">{title}</span>
        {hint && <span className="ml-auto text-xs text-ink-faint">{hint}</span>}
      </summary>
      <div className="reveal px-5 pb-5 pt-2">{children}</div>
    </details>
  );
}

/** Stacks several Disclosures in one container with hairline dividers. */
export function DisclosureGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ labels */

const DECISION_STYLE: Record<Decision, string> = { RECOVER: "text-plum-accent", UNDERSTAND: "text-info", HOLD: "text-ink-faint" };
const DECISION_TEXT: Record<Decision, string> = { RECOVER: "Recover", UNDERSTAND: "Understand", HOLD: "Hold" };

/** Decision outcome as a quiet uppercase label — the word carries the meaning. */
export function DecisionBadge({ d }: { d: Decision }) {
  return <span className={`text-2xs font-semibold uppercase tracking-wider ${DECISION_STYLE[d]}`}>{DECISION_TEXT[d]}</span>;
}

const STATUS_STYLE: Record<BehaviourStatus, string> = {
  on_rhythm: "text-good",
  slipping: "text-ink-soft",
  lapsed: "text-crimson-text",
  dormant: "text-ink-faint",
  new: "text-ink-faint",
  insufficient_history: "text-ink-faint",
};

/** Buying status as plain text; green = buying as usual, crimson = lapsed (at risk). */
export function StatusBadge({ s }: { s: BehaviourStatus }) {
  return <span className={`whitespace-nowrap text-xs ${STATUS_STYLE[s]}`}>{STATUS_LABEL[s]}</span>;
}

/** Subtle badge — reserve for genuinely important states (approved, suppressed, negative…). */
export function Tag({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "plum" | "red" | "green" | "outline"; title?: string }) {
  const t = {
    neutral: "bg-canvas text-ink-muted border-transparent",
    plum: "bg-plum text-plum-text border-transparent",
    red: "bg-crimson-bg text-crimson-text border-transparent",
    green: "bg-good-bg text-good border-transparent",
    outline: "bg-transparent text-ink-muted border-line-strong",
  }[tone];
  const badge = <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-2xs font-medium ${t}`}>{children}</span>;
  if (!title) return badge;
  // An explained badge gets the same info icon as every other definition.
  return (
    <span className="inline-flex items-center gap-1">
      {badge}
      <InfoTip text={title} label={typeof children === "string" ? `What does “${children}” mean?` : undefined} />
    </span>
  );
}

/** Where a number or statement comes from. Quiet text labels, consistent everywhere. */
export type Provenance = "observed" | "calculated" | "estimated" | "simulated" | "unvalidated";
export const PROVENANCE: Record<Provenance, { label: string; def: string; cls: string }> = {
  observed: { label: "Observed", def: "Directly in the uploaded records.", cls: "text-ink-faint" },
  calculated: { label: "Calculated", def: "Derived from the records with an explicit formula.", cls: "text-ink-faint" },
  estimated: { label: "Estimated", def: "Calculated from editable assumptions — not a measured result.", cls: "text-plum-text" },
  simulated: { label: "Simulated", def: "Generated for the demo, not observed in a real business.", cls: "rounded border border-dashed border-plum-accent px-1 text-plum-text" },
  unvalidated: { label: "Unvalidated", def: "Not yet confirmed by a sufficiently large randomised test.", cls: "italic text-ink-faint" },
};
export function Source({ kind }: { kind: Provenance }) {
  const p = PROVENANCE[kind];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className={`inline-flex text-2xs font-medium uppercase tracking-wider ${p.cls}`}>{p.label}</span>
      <InfoTip text={p.def} label={`What does “${p.label}” mean?`} />
    </span>
  );
}

export const SimulatedTag = () => <Source kind="simulated" />;
export const AssumptionTag = () => <Source kind="estimated" />;
export const SyntheticTag = () => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap">
    <span className="text-2xs font-medium uppercase tracking-wider text-ink-faint">Synthetic data</span>
    <InfoTip text="Fictional customers generated for the demo." label="What does “Synthetic data” mean?" />
  </span>
);

/* ----------------------------------------------------------------- buttons */
// Primary: one per page, deep plum. Secondary: quiet outline. Danger: crimson, destructive only.

const BTN = {
  primary: "bg-brand text-white border-brand hover:bg-brand-hover hover:border-brand-hover",
  secondary: "bg-surface text-ink border-line-strong hover:bg-surface-2",
  danger: "bg-transparent text-crimson-text border-crimson-line hover:bg-crimson-bg",
  ghost: "bg-transparent text-ink-muted border-transparent hover:bg-surface-2 hover:text-ink",
};
const SIZE = { sm: "h-8 px-3 text-xs", md: "h-9 px-3.5 text-sm" };

export function Button({
  children, onClick, variant = "secondary", disabled, title, type = "button", size = "md", icon,
}: {
  children: ReactNode; onClick?: () => void; variant?: keyof typeof BTN; disabled?: boolean; title?: string; type?: "button" | "submit"; size?: "sm" | "md"; icon?: IconName;
}) {
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0 ${BTN[variant]} ${SIZE[size]}`}>
      {icon && <Icon name={icon} className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, variant = "secondary", size = "md" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" }) {
  return (
    <Link href={href} className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border font-medium transition-colors duration-150 ${BTN[variant]} ${SIZE[size]}`}>
      {children}
    </Link>
  );
}

/** Text link styled consistently (no icon). */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink-muted">
      {children}
    </Link>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${value === o.value ? "bg-plum font-semibold text-plum-text" : "text-ink-muted hover:text-ink"}`}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1 tabular-nums text-ink-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const inputCls = "h-9 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-plum-accent";
export const selectCls = "h-9 max-w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-ink transition-colors hover:border-plum-accent";

/* ---------------------------------------------------------------- feedback */

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Inline message with a coloured left rule instead of an icon. */
export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success" | "sim"; children: ReactNode }) {
  const t = {
    info: "border-info bg-surface text-ink-soft",
    warn: "border-crimson bg-crimson-bg text-ink",
    error: "border-crimson bg-crimson-bg text-ink",
    success: "border-good bg-good-bg text-ink",
    sim: "border-plum-accent bg-plum text-ink",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-r-md border-l-2 px-3 py-2 text-sm ${t}`}>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4" role="status" aria-label="Loading customer data">
      <div className="h-7 w-56 rounded bg-surface-2" />
      <div className="h-24 rounded-lg bg-surface" />
      <div className="h-72 rounded-lg bg-surface" />
    </div>
  );
}

/** Loading and empty-data guard shared by all data pages. */
export function DataGate({ children, needsData = true }: { children: ReactNode; needsData?: boolean }) {
  const { ready, state } = useApp();
  if (!ready) return <Skeleton />;
  if (needsData && state.transactions.length === 0)
    return (
      <EmptyState title="No customer data yet" action={<ButtonLink href="/data" variant="primary">Upload customer data</ButtonLink>}>
        Upload a transaction CSV or load the demo dataset to get started.
      </EmptyState>
    );
  return <>{children}</>;
}

export function CustomerPicker({ value, onChange, filter }: { value: string | null; onChange: (id: string) => void; filter?: (id: string) => boolean }) {
  const { analysis } = useApp();
  const ids = analysis.profiles
    .map((p) => p.customerId)
    .filter((id) => !filter || filter(id))
    .sort((a, b) => (analysis.trials[b]?.priorityScore ?? 0) - (analysis.trials[a]?.priorityScore ?? 0) || a.localeCompare(b));
  const label = (d: Decision) => (d === "RECOVER" ? "Recover" : d === "UNDERSTAND" ? "Understand" : "Hold");
  return (
    <select aria-label="Select customer" className={`${selectCls} min-w-[220px]`} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Choose a customer…</option>}
      {ids.map((id) => (
        <option key={id} value={id}>
          {id} · {label(analysis.trials[id].decision)}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ tables */

export const th = "whitespace-nowrap px-5 py-3 text-left text-xs font-medium text-ink-faint";
export const td = "px-5 py-3.5 align-middle";
export const trHover = "border-t border-line transition-colors hover:bg-surface-2";

export function Pager({ page, pages, onPage, total, label }: { page: number; pages: number; onPage: (p: number) => void; total: number; label: string }) {
  if (pages <= 1) return <div className="px-5 py-3 text-xs text-ink-faint">{total} {label}</div>;
  return (
    <div className="flex items-center justify-between px-5 py-3 text-xs text-ink-faint">
      <span>{total} {label}</span>
      <span className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="tabular-nums">{page + 1} / {pages}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</Button>
      </span>
    </div>
  );
}
