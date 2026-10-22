"use client";
// Editor for the business assumptions used by Recovery Decisions (the Recovery Trial).
// Used live (what-if) in the Trial and as a saved form in Settings.
import { ACTION_LABEL } from "@/lib/trial";
import type { ActionId, Assumptions } from "@/lib/types";
import { fmtMoney, fmtPct, fmtPp } from "@/lib/utils";
import { InfoTip } from "./ui";

export function Slider({ label, value, min, max, step, fmt, onChange, hint, tip }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; hint?: string; tip?: string }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1 text-ink-soft">{label}{tip && <InfoTip text={tip} />}</span>
        <span className="font-semibold tabular-nums text-ink">{fmt(value)}</span>
      </div>
      <input type="range" className="mt-1 w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      {hint && <div className="text-xs text-ink-muted">{hint}</div>}
    </label>
  );
}

type ActionKey = Exclude<ActionId, "no_action">;

export function AssumptionsForm({ value, onChange }: { value: Assumptions; onChange: (a: Assumptions) => void }) {
  const set = (patch: Partial<Assumptions>) => onChange({ ...value, ...patch });
  const setAction = (a: ActionKey, k: keyof Assumptions["actions"]["check_in"], v: number) =>
    onChange({ ...value, actions: { ...value.actions, [a]: { ...value.actions[a], [k]: v } } });
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
      <fieldset className="space-y-4">
        <legend className="mb-3 text-2xs font-medium uppercase tracking-wider text-ink-faint">Business</legend>
        <Slider label="Contribution margin" value={value.marginRate} min={0.1} max={0.8} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => set({ marginRate: v })} tip="Share of revenue left after product costs. Decisions use contribution, not revenue." />
        <Slider label="Horizon" value={value.horizonDays} min={30} max={180} step={10} fmt={(v) => `${v} days`} onChange={(v) => set({ horizonDays: v })} />
        <Slider label="Minimum gain worth acting on" value={value.minIncrementalContribution} min={0} max={10} step={0.25} fmt={(v) => fmtMoney(v, 2)} onChange={(v) => set({ minIncrementalContribution: v })} tip="An action must be expected to add at least this much contribution, or REGAIN holds." />
        <Slider label="Loss per opt-out" value={value.optOutLoss} min={0} max={100} step={5} fmt={(v) => fmtMoney(v)} onChange={(v) => set({ optOutLoss: v })} tip="Future contribution lost if a contact makes the customer opt out." />
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-3 text-2xs font-medium uppercase tracking-wider text-ink-faint">How likely each action is to help (lift)</legend>
        {(["check_in", "reminder", "service_recovery", "benefit", "discount"] as const).map((a) => (
          <Slider key={a} label={ACTION_LABEL[a]} value={value.actions[a].upliftPp} min={0} max={0.3} step={0.005} fmt={(v) => fmtPp(v)} onChange={(v) => setAction(a, "upliftPp", v)} />
        ))}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-3 text-2xs font-medium uppercase tracking-wider text-ink-faint">Costs</legend>
        <Slider label="Discount rate" value={value.actions.discount.discountRate} min={0} max={0.4} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => setAction("discount", "discountRate", v)} />
        <Slider label="Service recovery cost" value={value.actions.service_recovery.contactCost} min={0} max={20} step={0.5} fmt={(v) => fmtMoney(v, 2)} onChange={(v) => setAction("service_recovery", "contactCost", v)} tip="Staff time to resolve the issue personally." />
        <Slider label="Benefit fulfilment cost" value={value.actions.benefit.benefitCost} min={0} max={15} step={0.5} fmt={(v) => fmtMoney(v, 2)} onChange={(v) => setAction("benefit", "benefitCost", v)} />
        <Slider label="Message cost" value={value.actions.reminder.contactCost} min={0} max={5} step={0.1} fmt={(v) => fmtMoney(v, 2)} onChange={(v) => onChange({ ...value, actions: { ...value.actions, reminder: { ...value.actions.reminder, contactCost: v }, discount: { ...value.actions.discount, contactCost: v } } })} tip="Cost of sending an automated reminder or discount message." />
      </fieldset>
    </div>
  );
}
