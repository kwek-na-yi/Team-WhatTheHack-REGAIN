// Contact policy: consent, opt-out suppression and contact-frequency caps.
// These are hard rules evaluated BEFORE any economics — no expected value can override them.
import type { Assumptions, CustomerProfile, InterventionRecord } from "./types";
import { daysBetween } from "./utils";

export interface PolicyResult {
  allowed: boolean;
  suppression?: "opted_out" | "no_consent" | "frequency_cap" | "declined";
  reason?: string;
  lastContactDate?: string;
  contactsLast90: number;
}

/** Contacts that actually reached the customer (control-group records are not contacts). */
export function contactDates(customerId: string, interventions: InterventionRecord[], asOf: string): string[] {
  return interventions
    .filter((r) => r.customerId === customerId && r.group !== "control" && r.action !== "none" && r.date <= asOf)
    .map((r) => r.date)
    .sort();
}

export function hasOptedOutViaIntervention(customerId: string, interventions: InterventionRecord[]): boolean {
  return interventions.some((r) => r.customerId === customerId && r.optedOut === "yes");
}

export function checkContactPolicy(
  profile: Pick<CustomerProfile, "customerId" | "optedOut" | "marketingConsent">,
  interventions: InterventionRecord[],
  asOf: string,
  a: Pick<Assumptions, "minDaysBetweenContacts" | "maxContactsPer90Days">,
  suppressedUntil?: Record<string, string>,
): PolicyResult {
  const dates = contactDates(profile.customerId, interventions, asOf);
  const last = dates[dates.length - 1];
  const contactsLast90 = dates.filter((d) => daysBetween(d, asOf) < 90).length;
  const base = { lastContactDate: last, contactsLast90 };
  if (profile.optedOut === "yes" || hasOptedOutViaIntervention(profile.customerId, interventions)) {
    return { ...base, allowed: false, suppression: "opted_out", reason: "Customer has opted out of marketing contact. Suppressed." };
  }
  if (profile.marketingConsent !== "yes") {
    return {
      ...base,
      allowed: false,
      suppression: "no_consent",
      reason: profile.marketingConsent === "no" ? "Marketing consent not given. Suppressed." : "Marketing consent not recorded — treated as no consent. Suppressed.",
    };
  }
  const until = suppressedUntil?.[profile.customerId];
  if (until && asOf < until) {
    return { ...base, allowed: false, suppression: "declined", reason: `Customer said they are not interested. Suppressed until ${until}.` };
  }
  if (last && daysBetween(last, asOf) < a.minDaysBetweenContacts) {
    return { ...base, allowed: false, suppression: "frequency_cap", reason: `Contacted ${daysBetween(last, asOf)} days ago; minimum gap is ${a.minDaysBetweenContacts} days.` };
  }
  if (contactsLast90 >= a.maxContactsPer90Days) {
    return { ...base, allowed: false, suppression: "frequency_cap", reason: `Already contacted ${contactsLast90} times in the last 90 days (cap ${a.maxContactsPer90Days}).` };
  }
  return { ...base, allowed: true };
}
