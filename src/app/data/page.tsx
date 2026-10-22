"use client";
import { useEffect, useState, type ReactNode } from "react";
import { AssumptionsForm, Slider } from "@/components/AssumptionsForm";
import { now, useApp } from "@/components/AppProvider";
import { Button, Card, Disclosure, Icon, inputCls, Notice, PageHeader, Pager, selectCls, Stat, StatGroup, SyntheticTag, Tag, td, th } from "@/components/ui";
import { maxDate } from "@/lib/behaviour";
import {
  autoMap,
  IV_FIELDS,
  MAX_FILE_BYTES,
  parseCsvText,
  TX_FIELDS,
  validateInterventions,
  validateTransactions,
  type DateFormat,
  type ImportReport,
  type IvField,
  type ParsedCsv,
  type TxField,
} from "@/lib/csv";
import { generateMessySample, generateSample, IV_HEADERS, rowsToCsv, SAMPLE_AS_OF, TX_HEADERS } from "@/lib/sampleData";
import type { Assumptions, InterventionRecord, Transaction } from "@/lib/types";
import { fmtPct, isIsoDate } from "@/lib/utils";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type Tab = "import" | "data" | "assumptions" | "contact" | "integrations" | "business" | "reset";
type Msg = { tone: "success" | "error" | "info"; text: string } | null;
const TABS: { id: Tab; label: string }[] = [
  { id: "import", label: "Upload & validate" },
  { id: "data", label: "Imported data" },
  { id: "assumptions", label: "Estimates" },
  { id: "contact", label: "Consent & limits" },
  { id: "integrations", label: "Integrations" },
  { id: "business", label: "Business" },
  { id: "reset", label: "Demo & reset" },
];

export default function DataPage() {
  const { ready } = useApp();
  const [tab, setTab] = useState<Tab>("data");
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    const sync = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.some((t) => t.id === h)) setTab(h);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    setMsg(null);
    window.history.replaceState(null, "", `#${t}`);
  };
  if (!ready) return <div className="text-sm text-ink-muted" role="status">Loading…</div>;
  return (
    <>
      <PageHeader title="Data & Integrations" subtitle="Add customer data, check it, and set the rules REGAIN follows. Everything stays in this browser." />
      <div role="tablist" aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${tab === t.id ? "border-plum-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div role="tabpanel">
        {tab === "data" && <DataTab />}
        {tab === "import" && (
          <div className="space-y-6">
            <ol className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted" aria-label="Import steps">
              <li><span className="font-semibold text-plum-accent">1</span> Upload a CSV</li>
              <li><span className="font-semibold text-plum-accent">2</span> Map columns</li>
              <li><span className="font-semibold text-plum-accent">3</span> Check validation</li>
              <li><span className="font-semibold text-plum-accent">4</span> Import valid rows</li>
            </ol>
            <Importer kind="tx" onDone={setMsg} />
            <Importer kind="iv" onDone={setMsg} />
          </div>
        )}
        {tab === "assumptions" && <AssumptionsTab onMsg={setMsg} />}
        {tab === "contact" && <ContactTab onMsg={setMsg} />}
        {tab === "integrations" && <IntegrationsTab />}
        {tab === "business" && <BusinessTab onMsg={setMsg} />}
        {tab === "reset" && <ResetTab onMsg={setMsg} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- data tab */

function DataTab() {
  const { state } = useApp();
  const [page, setPage] = useState(0);
  const s = state.importSummary;
  const PAGE = 20;
  const rows = [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return (
    <div className="space-y-6">
      <StatGroup>
        <Stat label="Source" value={<span className="text-lg">{state.dataSource === "sample" ? "Demo data" : state.dataSource === "upload" ? "Uploaded" : "None"}</span>} tag={state.dataSource === "sample" ? <SyntheticTag /> : undefined} />
        <Stat label="Transactions" value={state.transactions.length.toLocaleString()} hint={s ? `${s.rejectedRows} rejected · ${s.duplicateRows} duplicates` : undefined} />
        <Stat label="Contact records" value={state.interventions.length} hint={`${state.interventions.filter((r) => r.source === "app").length} from simulated sends`} />
        <Stat label="Analysis date" value={<span className="text-lg">{state.asOf}</span>} />
      </StatGroup>
      {s && s.optionalMissing.length > 0 && <p className="text-sm text-ink-muted">Optional fields not provided: {s.optionalMissing.join(", ")}.</p>}
      {s && s.excludedColumns.length > 0 && <p className="text-sm text-ink-muted">Columns discarded at import: {s.excludedColumns.map((c) => c.column).join(", ")}.</p>}

      <Card title="Transactions" subtitle={s ? `From ${s.fileName}` : undefined} padded={false}>
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-muted">No transactions loaded. Upload a CSV or load the demo data.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr><th className={th}>Date</th><th className={th}>Customer</th><th className={th}>Order</th><th className={th}>Category</th><th className={`${th} text-right`}>Value</th><th className={th}>Complaint</th><th className={th}>Consent</th></tr>
                </thead>
                <tbody>
                  {rows.slice(page * PAGE, page * PAGE + PAGE).map((t, i) => (
                    <tr key={t.orderId + i} className="border-t border-line">
                      <td className={`${td} py-2 tabular-nums`}>{t.date}</td>
                      <td className={`${td} py-2 font-medium`}>{t.customerId}</td>
                      <td className={`${td} py-2 text-ink-muted`}>{t.orderId}</td>
                      <td className={`${td} py-2`}>{t.category}</td>
                      <td className={`${td} py-2 text-right tabular-nums`}>${t.value.toFixed(2)}</td>
                      <td className={`${td} py-2`}>{t.serviceIssue ? <span className="text-crimson-text">{t.serviceIssue}</span> : <span className="text-ink-muted">—</span>}</td>
                      <td className={`${td} py-2 text-ink-muted`}>{t.optedOut === "yes" ? "Opted out" : t.marketingConsent ?? "unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line"><Pager page={page} pages={Math.ceil(rows.length / PAGE)} onPage={setPage} total={rows.length} label="transaction lines" /></div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ reset tab */

function ResetTab({ onMsg }: { onMsg: (m: Msg) => void }) {
  const { dispatch } = useApp();
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <div className="space-y-6">
      <Card title="Demo mode" subtitle="218 fictional customers of a coffee roaster — identical every time. Resetting clears experiments, conversations and pauses.">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => { dispatch({ type: "LOAD_SAMPLE", at: now() }); onMsg({ tone: "success", text: "Synthetic demo data loaded. Experiments, conversations and suppressions were reset." }); }}>
            Load / reset demo data
          </Button>
          <Button icon="download" onClick={() => download("regain_sample_transactions.csv", rowsToCsv(TX_HEADERS, generateSample().transactions))}>Transactions CSV</Button>
          <Button icon="download" onClick={() => download("regain_sample_interventions.csv", rowsToCsv(IV_HEADERS, generateSample().interventions))}>Contacts CSV</Button>
          <Button icon="download" onClick={() => download("regain_messy_sample.csv", generateMessySample())} title="Contains bad rows, duplicates and personal-data columns to show validation">Messy CSV</Button>
        </div>
      </Card>

      <section className="rounded-lg border border-crimson-line bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-crimson-text">Danger zone</h2>
        <p className="mt-1 text-sm text-ink-soft">Permanently removes all customer data, experiments, conversations and the audit trail from this browser. This can&apos;t be undone.</p>
        <div className="mt-3 flex gap-2">
          {!confirmClear ? (
            <Button variant="danger" onClick={() => setConfirmClear(true)}>Clear all data</Button>
          ) : (
            <>
              <Button variant="danger" onClick={() => { dispatch({ type: "CLEAR_ALL", at: now() }); setConfirmClear(false); onMsg({ tone: "info", text: "All data cleared from this browser." }); }}>Yes, clear everything</Button>
              <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* ----------------------------------------------------- integrations tab */

function IntegrationsTab() {
  const [ai, setAi] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/generate-message").then((r) => r.json()).then((d: { aiAvailable: boolean }) => setAi(d.aiAvailable)).catch(() => setAi(false));
  }, []);
  const rows: { name: string; status: ReactNode; detail: string }[] = [
    { name: "CSV upload", status: <Tag tone="green">Available</Tag>, detail: "Transactions and contact history, parsed and validated in your browser. This is the only data source today." },
    { name: "Anthropic Messages API", status: ai === null ? <Tag>Checking…</Tag> : ai ? <Tag tone="green">Connected</Tag> : <Tag tone="outline">Not configured</Tag>, detail: "Optional message drafting. Enabled only when ANTHROPIC_API_KEY is set on the server; templates are used otherwise." },
    { name: "Email, SMS and WhatsApp sending", status: <Tag tone="outline">Not built</Tag>, detail: "By design, REGAIN never sends messages. Approved messages are simulated and logged." },
    { name: "Live store, CRM or database connection", status: <Tag tone="outline">Not built</Tag>, detail: "There is no automatic sync. Export a CSV from your system and upload it here." },
  ];
  return (
    <Card title="Integrations" subtitle="What REGAIN connects to today" padded={false}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-line first:border-t-0">
              <td className={`${td} w-64 font-medium text-ink`}>{r.name}</td>
              <td className={`${td} w-36`}>{r.status}</td>
              <td className={`${td} text-ink-muted`}>{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ----------------------------------------------------------- import tab */

function Importer({ kind, onDone }: { kind: "tx" | "iv"; onDone: (m: Msg) => void }) {
  const { state, dispatch } = useApp();
  const fields = kind === "tx" ? TX_FIELDS : IV_FIELDS;
  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fmt, setFmt] = useState<DateFormat>("auto");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const report: ImportReport<Transaction | InterventionRecord> | null = parsed
    ? kind === "tx"
      ? validateTransactions(parsed, mapping as Partial<Record<TxField, string>>, fmt)
      : validateInterventions(parsed, mapping as Partial<Record<IvField, string>>, fmt)
    : null;

  const onFile = async (f: File | undefined) => {
    setError(null);
    setParsed(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return setError("Choose a .csv file.");
    if (f.size > MAX_FILE_BYTES) return setError(`File is ${(f.size / 1e6).toFixed(1)} MB. The limit is 5 MB.`);
    setLoading(true);
    try {
      const p = parseCsvText(await f.text());
      if (p.headers.length === 0 || p.rows.length === 0) throw new Error("no header row or no data rows");
      setParsed(p);
      setFile(f.name.slice(0, 80));
      setMapping(autoMap(p.headers, fields as { field: string; synonyms: string[] }[]) as Record<string, string>);
    } catch (e) {
      setError(`Couldn't read the file: ${e instanceof Error ? e.message : "unknown error"}.`);
    } finally {
      setLoading(false);
    }
  };

  const doImport = () => {
    if (!report || !file) return;
    if (kind === "tx") {
      const recs = report.records as Transaction[];
      const md = maxDate(recs) ?? SAMPLE_AS_OF;
      dispatch({ type: "IMPORT_TRANSACTIONS", records: recs, asOf: md, summary: { fileName: file, totalRows: report.totalRows, acceptedRows: report.acceptedRows, rejectedRows: report.rejectedRows, duplicateRows: report.duplicateRows, excludedColumns: report.excludedColumns, optionalMissing: report.optionalMissing }, at: now() });
      onDone({ tone: "success", text: `Imported ${recs.length} transaction lines. Analysis date set to ${md}. Previous data was replaced.` });
    } else {
      dispatch({ type: "IMPORT_INTERVENTIONS", records: report.records as InterventionRecord[], fileName: file, at: now() });
      onDone({ tone: "success", text: `Imported ${report.records.length} contact records.` });
    }
    setParsed(null);
    setFile(null);
  };

  const issues = report ? [...report.issues.filter((i) => i.severity === "error"), ...report.issues.filter((i) => i.severity === "warning")] : [];
  const excluded = new Set(report?.excludedColumns.map((c) => c.column) ?? []);
  const required = fields.filter((f) => f.required).map((f) => f.label.toLowerCase()).join(", ");

  return (
    <Card title={kind === "tx" ? "Transactions" : "Contact history (optional)"} subtitle={`Required: ${required}.${kind === "tx" ? " Missing consent is treated as no consent." : " Used for contact limits and past-campaign results."}`}>
      <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-line-strong bg-canvas px-4 py-4 text-sm transition-colors hover:border-ink-faint focus-within:border-ink-faint">
        <Icon name="upload" className="h-5 w-5 text-ink-muted" />
        <span className="text-ink-soft">{file ? <b className="text-ink">{file}</b> : kind === "tx" ? "Upload customer data — choose a CSV file (max 5 MB)" : "Upload contact history — choose a CSV file (max 5 MB)"}</span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="sr-only" aria-label={kind === "tx" ? "Transactions CSV file" : "Interventions CSV file"} />
      </label>
      {kind === "tx" && state.dataSource !== "empty" && !parsed && <p className="mt-2 text-xs text-ink-muted">Importing replaces the current dataset.</p>}
      {loading && <p className="mt-3 text-sm text-ink-muted" role="status">Reading file…</p>}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

      {parsed && report && (
        <div className="mt-5 space-y-4">
          {parsed.truncated && <Notice tone="warn">Only the first 50,000 rows were read.</Notice>}
          {report.excludedColumns.length > 0 && <Notice tone="info">Discarded columns (never stored or used): {report.excludedColumns.map((c) => `${c.column} — ${c.reason}`).join("; ")}.</Notice>}

          <StatGroup cols={5}>
            <Stat label="Rows read" value={report.totalRows} />
            <Stat label="Accepted" value={report.acceptedRows} tone="good" />
            <Stat label="Rejected" value={report.rejectedRows} tone={report.rejectedRows ? "bad" : undefined} />
            <Stat label="Duplicates removed" value={report.duplicateRows} />
            <Stat label="Blanks filled" value={Object.values(report.missingFilled).reduce((a, b) => a + b, 0)} hint={Object.entries(report.missingFilled).map(([k, v]) => `${k}: ${v}`).join(", ") || undefined} />
          </StatGroup>

          <div>
            <div className="mb-2 text-sm font-semibold text-ink">Map columns</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((f) => (
                <label key={f.field} className="text-sm">
                  <div className="mb-1 text-xs text-ink-muted">{f.label}{f.required && <span className="text-crimson-text"> *</span>}</div>
                  <select className={`${selectCls} w-full ${f.required && !mapping[f.field] ? "border-crimson" : ""}`} value={mapping[f.field] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.field]: e.target.value }))}>
                    <option value="">Not provided</option>
                    {parsed.headers.filter((h) => !excluded.has(h)).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
              <label className="text-sm">
                <div className="mb-1 text-xs text-ink-muted">Date format</div>
                <select className={`${selectCls} w-full`} value={fmt} onChange={(e) => setFmt(e.target.value as DateFormat)}>
                  <option value="auto">Auto (ISO, else day-first)</option><option value="ymd">YYYY-MM-DD</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option>
                </select>
              </label>
            </div>
            {report.unmappedRequired.length > 0 && <p className="mt-2 text-sm text-crimson-text">Map the required field{report.unmappedRequired.length > 1 ? "s" : ""}: {report.unmappedRequired.join(", ")}.</p>}
          </div>

          {issues.length > 0 && (
            <Disclosure title={`Row issues (${issues.length}${issues.length >= 300 ? "+" : ""})`} hint="Rejected and warned rows" defaultOpen>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                {issues.slice(0, 100).map((i, k) => (
                  <li key={k} className={i.severity === "error" ? "text-crimson-text" : "text-ink-soft"}>{i.row ? `Row ${i.row}` : "File"} · {i.field}: {i.message}</li>
                ))}
              </ul>
            </Disclosure>
          )}

          <Disclosure title="Preview" hint={`First ${Math.min(6, parsed.rows.length)} rows`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-line">{parsed.headers.map((h) => <th key={h} className={`${th} ${excluded.has(h) ? "line-through" : ""}`}>{h}</th>)}</tr></thead>
                <tbody>{parsed.rows.slice(0, 6).map((r, i) => <tr key={i} className="border-b border-line">{parsed.headers.map((h) => <td key={h} className={`${td} py-1.5 font-mono`}>{excluded.has(h) ? "•••" : String(r[h] ?? "").slice(0, 30)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </Disclosure>

          <div className="flex gap-2">
            <Button variant="primary" disabled={report.acceptedRows === 0} onClick={doImport}>Import {report.acceptedRows} valid rows</Button>
            <Button onClick={() => { setParsed(null); setFile(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------ assumptions tab */

function AssumptionsTab({ onMsg }: { onMsg: (m: Msg) => void }) {
  const { state, dispatch } = useApp();
  const [draft, setDraft] = useState<Assumptions>(state.assumptions);
  useEffect(() => setDraft(state.assumptions), [state.assumptions]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.assumptions);
  return (
    <div className="space-y-6">
      <Card title="Estimates used for every comparison" subtitle="Starting estimates, not predictions. Replace them with measured results from Impact & Experiments.">
        <AssumptionsForm value={draft} onChange={setDraft} />
      </Card>
      <Card title={`Chance of buying without any action (within ${draft.horizonDays} days)`} subtitle="By buying pattern">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(draft.baseline) as (keyof Assumptions["baseline"])[]).map((k) => (
            <Slider key={k} label={k === "on_rhythm" ? "On rhythm" : k.charAt(0).toUpperCase() + k.slice(1)} value={draft.baseline[k]} min={0} max={0.95} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => setDraft({ ...draft, baseline: { ...draft.baseline, [k]: v } })} />
          ))}
        </div>
      </Card>
      <SaveBar dirty={dirty} onSave={() => { dispatch({ type: "SET_ASSUMPTIONS", assumptions: draft, note: "Assumptions updated in Settings.", at: now() }); onMsg({ tone: "success", text: "Assumptions saved. All decisions recalculated." }); }} onDiscard={() => setDraft(state.assumptions)} onReset={() => { dispatch({ type: "RESET_ASSUMPTIONS", at: now() }); onMsg({ tone: "info", text: "Assumptions reset to defaults." }); }} />
    </div>
  );
}

function SaveBar({ dirty, onSave, onDiscard, onReset }: { dirty: boolean; onSave: () => void; onDiscard: () => void; onReset?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" disabled={!dirty} onClick={onSave}>Save changes</Button>
      <Button disabled={!dirty} onClick={onDiscard}>Discard</Button>
      {onReset && <Button variant="ghost" onClick={onReset}>Reset to defaults</Button>}
      {dirty && <span className="text-sm text-ink">Unsaved changes</span>}
    </div>
  );
}

/* ---------------------------------------------------------- contact tab */

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block max-w-sm">
      <div className="mb-1 text-sm font-medium text-ink">{label}</div>
      {children}
      {error ? <div className="mt-1 text-xs text-crimson-text">{error}</div> : hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </label>
  );
}

function ContactTab({ onMsg }: { onMsg: (m: Msg) => void }) {
  const { state, dispatch, analysis } = useApp();
  const a = state.assumptions;
  const [minDays, setMinDays] = useState(String(a.minDaysBetweenContacts));
  const [max90, setMax90] = useState(String(a.maxContactsPer90Days));
  const e1 = /^\d+$/.test(minDays) && +minDays >= 1 && +minDays <= 180 ? "" : "Enter a whole number from 1 to 180.";
  const e2 = /^\d+$/.test(max90) && +max90 >= 1 && +max90 <= 20 ? "" : "Enter a whole number from 1 to 20.";
  const dirty = minDays !== String(a.minDaysBetweenContacts) || max90 !== String(a.maxContactsPer90Days);
  const sup = analysis.suppressed;
  return (
    <div className="space-y-6">
      <StatGroup>
        <Stat label="Opted out" value={sup.opted_out} hint="Never contacted" />
        <Stat label="No consent recorded" value={sup.no_consent} hint="Treated as no consent" />
        <Stat label="Hit contact limit" value={sup.frequency_cap} />
        <Stat label="Declined recently" value={sup.declined} hint="Paused for 90 days" />
      </StatGroup>
      <Card title="Contact limits" subtitle="Hard rules, checked before any recommendation is made.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Minimum days between contacts" error={e1 || undefined} hint="Default 14">
            <input className={`${inputCls} w-28`} inputMode="numeric" value={minDays} onChange={(e) => setMinDays(e.target.value)} aria-invalid={!!e1} />
          </Field>
          <Field label="Maximum contacts per 90 days" error={e2 || undefined} hint="Default 2">
            <input className={`${inputCls} w-28`} inputMode="numeric" value={max90} onChange={(e) => setMax90(e.target.value)} aria-invalid={!!e2} />
          </Field>
        </div>
        <div className="mt-5">
          <SaveBar
            dirty={dirty && !e1 && !e2}
            onSave={() => {
              dispatch({ type: "SET_ASSUMPTIONS", assumptions: { ...a, minDaysBetweenContacts: +minDays, maxContactsPer90Days: +max90 }, note: `Contact limits set to ${minDays} days minimum gap and ${max90} contacts per 90 days.`, at: now() });
              onMsg({ tone: "success", text: "Contact limits saved." });
            }}
            onDiscard={() => { setMinDays(String(a.minDaysBetweenContacts)); setMax90(String(a.maxContactsPer90Days)); }}
          />
        </div>
      </Card>
      <Notice tone="info">Opt-outs and missing consent always block contact. They can&apos;t be overridden here or anywhere else.</Notice>
    </div>
  );
}

/* --------------------------------------------------------- business tab */

function BusinessTab({ onMsg }: { onMsg: (m: Msg) => void }) {
  const { state, dispatch } = useApp();
  const [businessName, setBusinessName] = useState(state.businessName);
  const [benefit, setBenefit] = useState(state.benefitDescription);
  const [asOf, setAsOf] = useState(state.asOf);
  const nameErr = businessName.trim() ? "" : "Required.";
  const dateErr = isIsoDate(asOf) ? "" : "Enter a valid date.";
  const dirty = businessName !== state.businessName || benefit !== state.benefitDescription || asOf !== state.asOf;
  return (
    <Card title="Business details" subtitle="Used in messages and as the date customers are evaluated on.">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Business name" error={nameErr || undefined}>
          <input className={`${inputCls} w-full`} value={businessName} maxLength={60} onChange={(e) => setBusinessName(e.target.value)} aria-invalid={!!nameErr} />
        </Field>
        <Field label="Non-monetary benefit wording" hint="Shown in benefit messages">
          <input className={`${inputCls} w-full`} value={benefit} maxLength={80} onChange={(e) => setBenefit(e.target.value)} />
        </Field>
        <Field label="Analysis date" error={dateErr || undefined} hint="Customers are evaluated as of this day">
          <input type="date" className={`${inputCls} w-full`} value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-invalid={!!dateErr} />
        </Field>
      </div>
      <div className="mt-5">
        <SaveBar
          dirty={dirty && !nameErr && !dateErr}
          onSave={() => { dispatch({ type: "SET_SETTINGS", patch: { businessName: businessName.trim(), benefitDescription: benefit.trim(), asOf }, at: now() }); onMsg({ tone: "success", text: "Settings saved. Analysis recalculated." }); }}
          onDiscard={() => { setBusinessName(state.businessName); setBenefit(state.benefitDescription); setAsOf(state.asOf); }}
        />
      </div>
    </Card>
  );
}
