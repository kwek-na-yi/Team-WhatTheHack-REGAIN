# REGAIN — Presentation Brief (single source of truth for the slides)

Every claim is tagged with one of these statuses:

- **[Implemented]** — in the code.
- **[Tested]** — covered by an automated test that was run.
- **[Estimated]** — produced from editable assumptions.
- **[Simulated]** — generated for the demo.
- **[Synthetic]** — fictional data.
- **[Planned]** — not built.

Do not put anything on a slide that is not in this file. Last checked against the code: 2026-10-21 (Decision Copilot added).

---

## 1. Identity

- **Name:** REGAIN
- **Descriptor:** The Retention Decision Engine
- **Tagline:** Recover the right customer. Choose the right action. Prove it was worth it.
- **Context:** AI-GNITION 2026, Eslitec Problem Statement 1 — *How might businesses turn existing customer data into personalised, automated conversations that measurably increase retention and repeat purchases?*

## 2. Problem

- Small businesses can see in their sales records that a customer is buying less often, but not why.
- Typical responses are generic messages or discounts. This leads to:
  - discounts paid on purchases that would have happened anyway;
  - promotions sent to customers with unresolved complaints;
  - success measured without a comparison group.

**Target users:** owners and marketing or customer-success staff at small and medium businesses with repeat customers and a transaction export (CSV). *(Product positioning — no user research has been conducted.)*

## 3. What REGAIN does — and its USP

**Workflow:** Detect → Compare → Decide → Converse → Measure → Learn **[Implemented]**

**USP — the Recovery Trial [Implemented][Tested]:**

- Before recommending anything, REGAIN compares six options for each customer **against doing nothing**: check-in, reminder, service recovery, non-monetary benefit, discount, no action.
- The comparison uses the customer's own buying pattern, consent and contact rules, the cost of each action, the extra contribution (margin, not revenue) and an uncertainty range.
- It decides **Recover**, **Understand** (ask first) or **Hold** (do nothing), and explains every rejected alternative.
- Estimates are labelled **[Estimated]**. The app never presents them as proven effects.

**Differentiators:**

| Claim | Status |
|---|---|
| Customers are compared with their own rhythm (median gap), not a store average | **[Implemented][Tested]** |
| "Do nothing" is a real, costed outcome | **[Implemented][Tested]** |
| Discount leakage is calculated (discount paid to customers likely to buy anyway) | **[Implemented][Tested]** |
| Facts, indicators, hypotheses and unknowns are shown separately | **[Implemented]** |
| Built-in randomised holdout with honest uncertainty | **[Implemented][Tested]** |

## 4. Current features (actual)

| Page | Feature | Status |
|---|---|---|
| Command Centre | Four data-derived metrics, Priority actions list, buying-pattern chart, demo cases, dismissible five-step guide | [Implemented][Tested] |
| Customer Directory | Search, decision/status filters, sorting, pagination | [Implemented][Tested] |
| Customer Insights — overview (`/insights`) | KPIs: customers analysed, customers requiring review, 90-day repeat-purchase rate (Calculated), estimated contribution opportunity (Estimated/unvalidated); orders/revenue trend with 3M/6M/12M/All; Recover/Understand/Hold bar chart that filters the priority table; priority table with contact eligibility from the contact policy | [Implemented][Tested] |
| Customer Insights — overview | Conversation journey from existing records (drafted → approved → reply; % only where one stage is a subset of the previous). Sends and replies are [Simulated]. Experiment outcomes are split observed / simulated / pending. | [Implemented][Tested]; sends and replies [Simulated] |
| Customer Insights — overview | Repeat purchases and value: repeat rate, average order value and incremental contribution, each with its formula. Contribution comes from Impact & Experiments, or is shown as "Not calculated" for the imported campaign. Lifetime value is not predicted. | [Implemented][Tested]; lifetime value [Planned] |
| Engagement & Journey (`/journeys`) | A read-only monitor derived from existing records. Shows journey stages (a share only where one stage is a subset of the previous), journeys (REGAIN actions, Hold groups, imported campaigns, experiments), customer activity with rule-based next steps, a timeline labelled Observed / Recorded / Simulated / Calculated, and outcomes after contact. Demo: 73 customers contacted in imported records; 75.4% bought within 30 days (49 of 65). | [Implemented][Tested]; sends and replies [Simulated]; recurring automations [Planned] |
| Customer Insights — profile (`/insights?id=…`, `/customers/[id]`) | "What this means" plain-English reading, recommendation with links, labelled purchase timeline with the usual vs current gap, contact eligibility, service interactions, previous actions, evidence layers | [Implemented][Tested] |
| Recovery Decisions | Recommendation panel, reasoning path, alternatives comparison, live what-if estimates | [Implemented][Tested] |
| Conversation Studio | Template drafting, claims check, human approval gate, reject with reason, four simulated replies that change the next step | [Implemented][Tested]; sends and replies [Simulated] |
| Conversation Studio | Optional AI drafting via Anthropic Messages API | [Implemented]; **not tested against the live API** |
| Impact & Experiments | Past-campaign analysis, holdout creation, outcome recording, statistics, "update estimate from result" | [Implemented][Tested]; "Simulate outcomes" [Simulated] |
| Data & Integrations | CSV upload, mapping, validation, imported-data table, estimates, consent and contact limits, integrations status, demo reset | [Implemented][Tested] |
| Responsible AI & Audit | Status tiles, per-customer compliance check, safeguards, disclosures, audit trail with export | [Implemented][Tested] |
| Decision Copilot (**Ask REGAIN**, every page) | Side panel for questions about REGAIN's own results: explain a decision, compare actions or run a what-if, search the portfolio, interpret an experiment. Answers are computed by the engine and labelled Observed / Calculated / Estimated / Simulated / Rule. Suggested questions follow the page and the active customer. | [Implemented][Tested]; deterministic |
| Decision Copilot | What-ifs are re-run through the Recovery Trial on a copy of the assumptions and labelled *not saved*. Saving needs a two-step confirmation and is audited. Consent, opt-out and contact-limit bypass requests are refused. The Copilot cannot approve or send messages. | [Implemented][Tested] |
| Decision Copilot | Optional AI rewording of verified, redacted facts (no IDs, records or CSV). The reply is validated on the server and in the browser; on failure, REGAIN's own wording is kept. | [Implemented]; tested with mocked responses only, **not tested against the live API** |

### Decision Copilot — what to say on a slide

- "Ask REGAIN *why*." It explains its own decisions, compares alternatives, runs what-ifs and interprets experiments.
- Every number comes from the same Recovery Trial and experiment code as the pages. The language model, when enabled, may only reword. **[Implemented][Tested]**
- It cannot change consent, opt-out or contact limits, and it cannot send anything. **[Implemented][Tested]**
- Do **not** claim it improves retention. It makes the existing decisions easier to understand and check.

## 5. Architecture (actual)

- **Frontend:** Next.js 15 + React 19 + TypeScript, Tailwind CSS, Recharts. All analysis runs in the browser. **[Implemented]**
- **State:** a reducer persisted to browser `localStorage`. No database. **[Implemented]**
- **Server:** two optional API routes, AI message drafting (`/api/generate-message`) and AI rewording of Copilot answers (`/api/copilot`). Both work without a key. **[Implemented]**
- **Decision Copilot pipeline:**
  1. A deterministic context step uses the active customer, the saved assumptions and the analysis results.
  2. Allowlisted, typed answer functions (`src/lib/copilot.ts`) call the existing engine.
  3. A redaction step builds the facts that may leave the browser (`src/lib/copilotGuard.ts`).
  4. An optional model rewords those facts.
  5. A validator discards unsupported wording.
  6. The UI shows the evidence cards.

  **[Implemented][Tested]**
- **Logic modules:** CSV validation, behaviour indicators, contact policy, Recovery Trial, conversation state machine, experiment statistics. **[Implemented][Tested]**

## 6. Data sources (actual)

- A synthetic dataset of 218 fictional customers (3,601 transaction lines, 149 contact records) for "Kopi & Co. Roasters", generated with a fixed seed. **[Synthetic]**
- User-uploaded CSV files. **[Implemented]**
- No real customer data, partners or live integrations. Live connectors are **[Planned]**.

## 7. External AI tools and libraries

| Component | Use | Status |
|---|---|---|
| Anthropic Messages API | Optional message drafting, only with a server key; off in the demo | [Implemented], untested live |
| Anthropic Messages API | Optional rewording of Copilot answers from redacted facts, only with a server key and an opt-in checkbox; off in the demo | [Implemented], tested with mocked responses only, untested live |
| Next.js, React, Tailwind CSS, Recharts, Papa Parse | Application | [Implemented] |
| Vitest, puppeteer-core | Testing | [Implemented] |
| Claude Code (AI coding assistant) | Used to help build the prototype | Disclosure |

## 8. Testing (actual results)

- **Unit tests (Vitest):** 151 / 151 passed (run 2026-10-22), including 34 Decision Copilot, 20 Customer Insights and 21 Engagement & Journey tests. **[Tested]**
  - Engagement & Journey: stage derivation, unique customers vs records, 30-day windows, timeline order and source labels, no invented timestamps, blocked customers never suggested for contact, REGAIN vs imported attribution, filters, sorting, reset and import;
  - Customer Insights: trend periods and order grouping, repeat-rate eligibility and observation windows, decision counts and table filters, ranking that ignores past spend, contact eligibility, journey subsets and simulated labels, pending outcomes never counted, "What this means", import/reset/clear;
  - Decision Copilot: grounded explanations, what-ifs identical to the Recovery Trial, no state mutation without confirmation, real portfolio counts, honest no-results, experiment verdicts, simulated labelling, redaction of AI context, AI output validation and fallbacks;
  - CSV validation and import;
  - interval and sparse-data calculations;
  - decision ranking;
  - scenario arithmetic;
  - no-action decisions;
  - consent, opt-out and contact limits;
  - conversation state transitions;
  - group assignment;
  - statistics and impact metrics;
  - reset.
- **End-to-end browser test (headless Edge, production build on a Vercel preview):** 89 / 89 checks passed (run 2026-10-22) **[Tested]**. It covers:
  - Engagement & Journey: sidebar entry, funnel counts after Studio actions, KPI units, the imported journey, stage filter, timeline order, blocked and rejected next steps, search, Show customers, Clear filters, profile navigation and phone width;
  - Customer Insights: profile wording and gap line, overview KPIs and demo label, both charts, the range and measure toggles, bar-click and button filters, the opted-out customer shown as blocked, View customer → correct profile and active case, browser back, journey counts after Studio actions, and phone width;
  - the Decision Copilot: context, explanation, no-AI disclosure, a what-if that doesn't change saved data, the confirmation step, the opt-out bypass refusal, navigation to the right customer, portfolio cards, simulated-outcome labelling, and the panel at phone width;
  - navigation and every page;
  - customer selection carried between pages;
  - live decision changes;
  - the approval and reply flow;
  - consent blocking and the contact limit;
  - CSV import and validation;
  - experiments;
  - the audit trail;
  - phone-width layout;
  - no console errors.
- **Production build** succeeds. **[Tested]**

## 9. What kind of number is each metric?

| Metric | Type |
|---|---|
| Customers analysed, transactions, consent counts, past campaign outcomes | Observed (from [Synthetic] data in the demo) |
| Days since last purchase, usual gap, status, spending change, evidence score | Calculated |
| 90-day repeat-purchase rate (79.1%, 167 of 211 eligible; 7 excluded as still inside their window) and average order value ($47.18, last 12 months) | Calculated from [Synthetic] data |
| Extra contribution per action, "estimated contribution opportunity" ($192 on demo data), uncertainty ranges | [Estimated] — unvalidated |
| Studio sends and replies; "Simulate outcomes" results | [Simulated] |
| May-26 campaign: +9.5 pp (75.7% vs 66.2%, n = 70/71), likely range −5.5 to +23.9 pp, p = 0.213 | Observed in [Synthetic] data. **Not statistically conclusive**; the app says so. |

Demo decision counts: 68 Recover, 15 Understand, 135 Hold; 35 customers blocked by consent, opt-out or contact rules. **[Synthetic]**

## 10. Business-value methodology

- **Extra contribution** = (chance with action − chance without) × orders if they return × order value × margin − cost of the action. Discounts are charged to every redeemer, including customers who would have bought anyway. **[Implemented]**
- **Example (C0053):** reminder **$4.10**, versus discount **$2.37** after **$2.92** of leakage. **[Estimated]**
- **Proof of value:** only a randomised holdout. Compare customers who received the action with those who did not, using 95% intervals and a sample-size check. **[Implemented]**
- **No real-world revenue improvement has been measured.** Do not claim one.

## 11. Responsible AI safeguards

| Safeguard | Status |
|---|---|
| Consent first (missing = no consent); opt-outs respected; 90-day pause after "not interested" | [Implemented][Tested] |
| Contact limits: 14-day gap, 2 per 90 days | [Implemented][Tested] |
| Human approval gate and claims check against unsupported statements | [Implemented][Tested] |
| Sensitive attributes and direct identifiers discarded at import | [Implemented][Tested] |
| No messages sent | By design |
| Estimates and simulations labelled; simulations cannot update estimates | [Implemented] |
| Audit trail of decisions and actions | [Implemented][Tested] |

## 12. Current limitations

- Heuristic estimates, not a trained model.
- Purchases elsewhere are invisible.
- Only the latest open complaint is considered.
- Refunds are not netted off.
- Browser-only storage; no multi-user access or live integrations.
- Engagement & Journey cannot measure deliveries, opens, clicks or real replies (no messaging integration), or when a draft was created. A purchase after contact is not causal lift.
- Neither optional AI path (message drafting, Copilot rewording) has been tested against the live API.
- The Decision Copilot routes questions by keyword patterns and uses the saved assumptions only. What-ifs cover the discount rate, an action's lift, the margin, the horizon and a hypothetical complaint.

## 13. Next steps [Planned]

- Calibrate estimates from real holdout results per business.
- A consent-synchronised messaging integration (email / SMS / WhatsApp).
- Connectors to store, CRM or point-of-sale systems.
- Multi-user storage with server-side audit logs.
- Customer lifetime-value forecasting, once retention and margin assumptions are validated by real holdout results.
- Retention cohort charts, for datasets with enough customers per cohort.

---

*Update this brief whenever the implementation changes materially.*
