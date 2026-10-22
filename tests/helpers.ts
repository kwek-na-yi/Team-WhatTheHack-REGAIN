import { buildProfiles } from "@/lib/behaviour";
import type { CustomerProfile, Transaction } from "@/lib/types";
import { addDays } from "@/lib/utils";

export const AS_OF = "2026-09-30";

/** Orders for one customer at given day offsets before AS_OF (positive numbers = days ago). */
export function txFor(id: string, daysAgo: number[], opts: Partial<Transaction> = {}, value = 40): Transaction[] {
  return daysAgo.map((d, i) => ({
    customerId: id,
    orderId: `${id}-${i}`,
    date: addDays(AS_OF, -d),
    value,
    category: "Coffee Beans",
    marketingConsent: "yes",
    optedOut: "no",
    ...opts,
  }));
}

/** Regular buyer: `n` orders every `interval` days, the last one `lastGap` days ago. */
export function regular(id: string, interval: number, lastGap: number, n = 8, opts: Partial<Transaction> = {}): Transaction[] {
  return txFor(id, Array.from({ length: n }, (_, i) => lastGap + (n - 1 - i) * interval), opts);
}

export function profileOf(txns: Transaction[], id: string): CustomerProfile {
  const p = buildProfiles(txns, { asOf: AS_OF }).find((x) => x.customerId === id);
  if (!p) throw new Error("no profile");
  return p;
}
