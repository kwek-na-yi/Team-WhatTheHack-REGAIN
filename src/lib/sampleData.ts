// SYNTHETIC demonstration dataset for a fictional Singapore coffee roaster ("Kopi & Co. Roasters").
// Fully deterministic (seeded PRNG) — every load produces identical data. Contains no real people.
// Rows are emitted as raw CSV-shaped records and go through the SAME validation pipeline as uploads.
import { addDays, daysBetween, fnv1a, mulberry32 } from "./utils";

export const SAMPLE_AS_OF = "2026-09-30";
export const SAMPLE_START = "2025-01-06";
export const SAMPLE_BUSINESS = "Kopi & Co. Roasters (fictional)";
export const SAMPLE_SEED = 2026;

/** The past campaign embedded in the sample: a randomised reminder test with a true (synthetic) effect. */
export const SAMPLE_CAMPAIGN = { name: "May-26 replenishment reminder test", date: "2026-05-12", windowDays: 30, trueExtraPurchaseRate: 0.12 };

export const TX_HEADERS = ["customer_id", "order_id", "date", "value", "category", "service_issue", "issue_resolved", "marketing_consent", "opted_out"] as const;
export const IV_HEADERS = ["customer_id", "date", "action", "group", "purchased", "opted_out", "campaign"] as const;

type Row = Record<string, string>;

const ISSUES = ["Late delivery", "Damaged packaging", "Wrong grind size sent", "Order arrived incomplete"];

interface Archetype {
  name: string;
  count: number;
}

const ARCHETYPES: Archetype[] = [
  { name: "regular_on_rhythm", count: 52 },
  { name: "regular_slipping", count: 30 },
  { name: "regular_lapsed", count: 22 },
  { name: "service_issue", count: 16 },
  { name: "irregular", count: 30 },
  { name: "declining_high_value", count: 10 },
  { name: "dormant", count: 12 },
  { name: "two_orders", count: 10 },
  { name: "one_off", count: 36 },
];

export function generateSample(seed = SAMPLE_SEED): { transactions: Row[]; interventions: Row[] } {
  const rng = mulberry32(seed);
  const rand = (lo: number, hi: number) => lo + (hi - lo) * rng();
  const randint = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const money = (x: number) => x.toFixed(2);

  const tx: Row[] = [];
  const iv: Row[] = [];
  let cust = 0;
  let orderSeq = 1000;
  const customerDates = new Map<string, string[]>();
  const customerMeta = new Map<string, { consent: string; optedOut: string; beanValue: number; archetype: string }>();

  const addOrder = (id: string, date: string, opts: { category?: string; issue?: string; resolved?: string } = {}) => {
    const meta = customerMeta.get(id)!;
    const orderId = `K${orderSeq++}`;
    const category = opts.category ?? "Coffee Beans";
    const base =
      category === "Coffee Beans" ? meta.beanValue * rand(0.88, 1.12)
      : category === "Brewing Equipment" ? rand(45, 180)
      : category === "Tea" ? rand(15, 26)
      : category === "Gift Sets" ? rand(50, 95)
      : rand(55, 70);
    tx.push({
      customer_id: id, order_id: orderId, date, value: money(base), category,
      service_issue: opts.issue ?? "", issue_resolved: opts.issue ? opts.resolved ?? "no" : "",
      marketing_consent: meta.consent, opted_out: meta.optedOut,
    });
    // Occasional second line on the same order (accessory add-on).
    if (category === "Coffee Beans" && rng() < 0.1) {
      tx.push({ customer_id: id, order_id: orderId, date, value: money(rand(8, 24)), category: "Brewing Equipment", service_issue: "", issue_resolved: "", marketing_consent: meta.consent, opted_out: meta.optedOut });
    }
    const arr = customerDates.get(id) ?? [];
    arr.push(date);
    customerDates.set(id, arr);
  };

  /** Regular buyer: build backwards from the last order date with ±15% jitter. */
  const regular = (id: string, interval: number, lastGap: number, catMix = 0.9) => {
    let d = addDays(SAMPLE_AS_OF, -lastGap);
    const dates: string[] = [];
    while (d >= SAMPLE_START) {
      dates.push(d);
      d = addDays(d, -Math.max(5, Math.round(interval * rand(0.85, 1.15))));
    }
    dates.reverse().forEach((dt) => addOrder(id, dt, { category: rng() < catMix ? "Coffee Beans" : pick(["Tea", "Brewing Equipment"]) }));
  };

  for (const arch of ARCHETYPES) {
    for (let k = 0; k < arch.count; k++) {
      cust++;
      const id = `C${String(cust).padStart(4, "0")}`;
      const r = rng();
      // Consent mix: ~84% yes, ~6% no, ~5% not recorded, ~5% opted out.
      const consent = r < 0.84 ? "yes" : r < 0.9 ? "no" : r < 0.95 ? "" : "yes";
      const optedOut = r >= 0.95 ? "yes" : consent === "" ? "" : "no";
      customerMeta.set(id, { consent, optedOut, beanValue: rand(26, 52), archetype: arch.name });
      const interval = randint(18, 40);
      switch (arch.name) {
        case "regular_on_rhythm":
          regular(id, interval, randint(1, Math.round(interval * 1.1)));
          break;
        case "regular_slipping":
          regular(id, interval, Math.round(interval * rand(1.35, 1.9)));
          break;
        case "regular_lapsed":
          regular(id, interval, Math.round(interval * rand(2.1, 3.6)));
          break;
        case "dormant":
          regular(id, interval, Math.round(interval * rand(4.5, 9)));
          break;
        case "service_issue": {
          const lastGap = Math.round(interval * rand(1.6, 3.4));
          let d = addDays(SAMPLE_AS_OF, -lastGap);
          const dates: string[] = [];
          while (d >= SAMPLE_START) {
            dates.push(d);
            d = addDays(d, -Math.max(5, Math.round(interval * rand(0.85, 1.15))));
          }
          dates.reverse();
          const resolved = k % 4 === 3 ? "yes" : "no";
          dates.forEach((dt, i) => addOrder(id, dt, i === dates.length - 1 ? { issue: pick(ISSUES), resolved } : {}));
          break;
        }
        case "irregular": {
          let d = addDays(SAMPLE_START, randint(0, 120));
          const lastAllowed = addDays(SAMPLE_AS_OF, -randint(20, 200));
          while (d <= lastAllowed) {
            addOrder(id, d, { category: pick(["Brewing Equipment", "Gift Sets", "Coffee Beans", "Tea", "Workshop"]) });
            d = addDays(d, randint(25, 160));
          }
          if (!customerDates.get(id)) addOrder(id, lastAllowed, { category: "Gift Sets" });
          break;
        }
        case "declining_high_value": {
          customerMeta.get(id)!.beanValue = rand(70, 110);
          let d = addDays(SAMPLE_START, randint(0, 20));
          let gap = randint(12, 18);
          const dates: string[] = [];
          while (d <= addDays(SAMPLE_AS_OF, -1)) {
            dates.push(d);
            d = addDays(d, gap);
            if (d > "2026-03-01") gap = Math.round(gap * rand(1.35, 1.6));
          }
          dates.forEach((dt) => addOrder(id, dt));
          // One-off large equipment purchase (an outlier the median must ignore).
          addOrder(id, addDays(dates[Math.floor(dates.length / 3)], 2), { category: "Brewing Equipment" });
          break;
        }
        case "two_orders": {
          const second = addDays(SAMPLE_AS_OF, -randint(30, 140));
          addOrder(id, addDays(second, -randint(20, 60)));
          addOrder(id, second);
          break;
        }
        case "one_off":
          addOrder(id, addDays(SAMPLE_AS_OF, -randint(5, 500)), { category: pick(["Coffee Beans", "Gift Sets", "Brewing Equipment", "Workshop"]) });
          break;
      }
    }
  }

  // ---- Historical randomised campaign (May 2026) --------------------------------------------
  // Eligible: consented, not opted-out repeat customers with an order before the campaign date.
  // Assignment: deterministic hash split 50/50. Treatment received a reminder. A true synthetic
  // effect is injected: a share of treated non-buyers make an extra purchase inside the window.
  const camp = SAMPLE_CAMPAIGN;
  const campEnd = addDays(camp.date, camp.windowDays);
  for (const [id, meta] of customerMeta) {
    if (meta.consent !== "yes" || meta.optedOut === "yes") continue;
    const dates = customerDates.get(id) ?? [];
    const before = dates.filter((d) => d < camp.date);
    if (before.length < 2 || daysBetween(before[before.length - 1], camp.date) > 120) continue;
    const treated = fnv1a(`${id}:may26`) % 2 === 0;
    const boughtInWindow = () => (customerDates.get(id) ?? []).some((d) => d > camp.date && d <= campEnd);
    if (treated && !boughtInWindow() && rng() < camp.trueExtraPurchaseRate) {
      addOrder(id, addDays(camp.date, randint(3, 25)));
    }
    const purchased = boughtInWindow() ? "yes" : "no";
    const optOut = treated && rng() < 0.01 ? "yes" : "no";
    iv.push({ customer_id: id, date: camp.date, action: treated ? "reminder" : "none", group: treated ? "treatment" : "control", purchased, opted_out: optOut, campaign: camp.name });
  }

  // ---- Recent contacts that trigger frequency caps -------------------------------------------
  let capped = 0;
  for (const [id, meta] of customerMeta) {
    if (capped >= 8) break;
    if (meta.consent === "yes" && meta.optedOut !== "yes" && (meta.archetype === "regular_slipping" || meta.archetype === "regular_lapsed") && fnv1a(id) % 3 === 0) {
      iv.push({ customer_id: id, date: addDays(SAMPLE_AS_OF, -randint(3, 10)), action: "check_in", group: "treatment", purchased: "", opted_out: "no", campaign: "Sept-26 manual check-ins" });
      capped++;
    }
  }

  tx.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order_id.localeCompare(b.order_id)));
  return { transactions: tx, interventions: iv };
}

export function rowsToCsv(headers: readonly string[], rows: Row[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))].join("\n");
}

/** A deliberately messy variant for demonstrating validation (duplicates, bad dates, missing values, PII columns). */
export function generateMessySample(): string {
  const { transactions } = generateSample();
  const rows = transactions.slice(0, 400).map((r) => ({ ...r }));
  rows[3] = { ...rows[3], date: "31/02/2026" };
  rows[7] = { ...rows[7], value: "abc" };
  rows[11] = { ...rows[11], customer_id: "" };
  rows[15] = { ...rows[15], value: "-12.50" };
  rows[19] = { ...rows[19], category: "" };
  rows[23] = { ...rows[23], date: "04/05/2026" };
  rows.push({ ...rows[30] }, { ...rows[31] });
  const headers = [...TX_HEADERS, "email", "gender"];
  const withPii = rows.map((r, i) => ({ ...r, email: `person${i}@example.com`, gender: i % 2 ? "F" : "M" }));
  return rowsToCsv(headers, withPii);
}
