// Derives all customer-level analysis from application state (pure; memoised by the provider).
import { buildProfiles } from "./behaviour";
import { runTrial } from "./trial";
import type { CustomerProfile, TrialResult } from "./types";
import type { AppState } from "./store";

export interface Analysis {
  profiles: CustomerProfile[];
  trials: Record<string, TrialResult>;
  byId: Record<string, CustomerProfile>;
  counts: { RECOVER: number; UNDERSTAND: number; HOLD: number };
  suppressed: { opted_out: number; no_consent: number; frequency_cap: number; declined: number };
  expectedIncremental: number;
}

export function analyse(s: Pick<AppState, "transactions" | "interventions" | "asOf" | "assumptions" | "suppressedUntil">): Analysis {
  const profiles = buildProfiles(s.transactions, { asOf: s.asOf });
  const trials: Record<string, TrialResult> = {};
  const byId: Record<string, CustomerProfile> = {};
  const counts = { RECOVER: 0, UNDERSTAND: 0, HOLD: 0 };
  const suppressed = { opted_out: 0, no_consent: 0, frequency_cap: 0, declined: 0 };
  let expectedIncremental = 0;
  for (const p of profiles) {
    byId[p.customerId] = p;
    const t = runTrial(p, { assumptions: s.assumptions, interventions: s.interventions, asOf: s.asOf, suppressedUntil: s.suppressedUntil });
    trials[p.customerId] = t;
    counts[t.decision]++;
    if (t.suppression) suppressed[t.suppression]++;
    expectedIncremental += t.priorityScore;
  }
  return { profiles, trials, byId, counts, suppressed, expectedIncremental };
}
