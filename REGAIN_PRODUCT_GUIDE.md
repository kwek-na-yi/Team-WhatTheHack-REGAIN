# REGAIN — Product Guide

**REGAIN — The Retention Decision Engine.** *Recover the right customer. Choose the right action. Prove it was worth it.*

This guide describes **only what is implemented in this repository**, checked against the code on 2026-10-19. The Decision Copilot (section 4.9) was added and checked on 2026-10-21. Anything simulated, estimated or not built is labelled as such. File paths point to where each piece lives.

---

## 1. What REGAIN does

REGAIN reads a small business's sales records and, for each customer, answers:

1. **Has this customer's buying habit changed?** Each customer is compared with their *own* usual gap between purchases.
2. **Should we act — and how?** It compares a helpful check-in, a replenishment reminder, fixing a service problem, a non-monetary thank-you, a discount and **doing nothing**.
3. **Is it worth it?** It estimates the extra contribution (margin after the action's cost) of each option.
4. **What should we say?** It drafts a message from facts in the record; a person must review and approve it. Nothing is sent.
5. **Did it work?** It compares customers who received an action with customers who did not.

### The problem

Sales records show *that* a customer is buying less often, not *why*. Businesses often respond with generic messages or discounts. This leads to:

- discounts paid to customers who would have bought anyway;
- promotions sent to customers with an unresolved complaint;
- success claimed from "customers who came back", with no comparison group.

### The USP — the Recovery Trial, in plain English

Before suggesting any action, REGAIN runs a **Recovery Trial** for that customer. Every possible action is compared side by side with *doing nothing*, using:

- the evidence in the record;
- the cost of each action;
- the expected extra contribution;
- how uncertain the estimate is;
- consent and contact rules, which can rule an action out entirely.

The result is one of three decisions:

| Decision | Meaning |
|---|---|
| **Recover** | The cause is evidenced and an action is expected to pay for itself. |
| **Understand** | Buying slowed but the data doesn't show why, so ask a low-pressure question first. |
| **Hold** | Do nothing for now: buying as usual, too little history, not worth the cost, or contact not allowed. |

A churn dashboard tells you *who* might leave. REGAIN decides *what to do* — including nothing — shows *why*, shows *what the alternatives would cost*, and helps you *measure* whether it worked.

---

## 2. Running the project

Requirements: Node.js 20+ (tested on Node 24.16, npm 11.13).

```bash
npm install
npm run dev              # http://localhost:3000 — demo data loads automatically
npm test                 # 76 unit tests (Vitest)
npm run build && npm start   # production build and server
npm run e2e              # end-to-end browser test (needs the app running; BASE_URL if not port 3000)
npm run sample           # writes the synthetic CSVs to public/samples/
```

Optional AI drafting: set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) on the server. Without it, templates are used.

If the project folder is synced by OneDrive and `npm run dev` fails with `EINVAL … .next`, delete the `.next` folder and run it again.

---

## 3. The end-to-end journey

1. **Data & Integrations → Upload & validate.** Upload a transaction CSV, map columns, check validation and import valid rows. Or use **Demo & reset → Load / reset demo data**.
2. **Command Centre.** See how many customers need review and the **Priority actions** list. Click **Review case**.
3. **Customer Directory / Customer Insights.** Search and filter customers. The Insights overview shows trends, decisions, priority customers, the journey and measured value. Open a profile to see one customer's evidence.
4. **Recovery Decisions.** Read the recommendation, why, its estimated value and how certain it is. Optionally compare alternatives or adjust the estimates.
5. **Conversation Studio.** Generate the message, edit it, pass the claims check, approve it, then simulate the reply.
6. **Engagement & Journey.** See where every customer is in their recovery journey, what happened after a contact, and who needs a review next (section 4.10).
7. **Impact & Experiments.** Review a past campaign or create a holdout experiment; record or simulate outcomes; optionally update an estimate from a measured result.
8. **Responsible AI & Audit.** Check any customer's eligibility, approvals and evidence; review the audit trail.

The customer you open stays selected (**Active case**, top right). The workflow bar (Detect → Compare → Decide → Converse → Measure → Learn) and the case progress bar (Detected → Decided → Conversation → Outcome) link between pages.

---

## 4. Every page

### 4.1 Command Centre (`/`, `src/app/page.tsx`)

1. **Name:** Command Centre.
2. **Purpose:** Show what needs attention and what to do next.
3. **What you see:**
   - **Header:** "Review recommended actions" button.
   - **First-time guide:** five steps, dismissible.
   - **Four metrics:** customers analysed; customers requiring review; pending recovery actions; estimated contribution opportunity (*Estimated*).
   - **Priority actions:** the six highest-value Recover/Understand customers, each with what changed, the next action, estimated value and **Review case**.
   - **Main chart:** customers by buying pattern.
   - **Demo cases:** synthetic data only.
   - **More detail (collapsed):** monthly revenue line, why customers are on hold, last measured test.
4. **What you can do:** open the directory filtered to customers needing action; open any priority case in Recovery Decisions; open a demo case; dismiss or reopen the guide (sidebar "How REGAIN works", `/?guide=1`).
5. **Data source:** the analysis of the loaded transactions and contact history (`src/lib/analysis.ts`); conversations in app state.
6. **Rules and calculations:**
   - *Requiring review* = Recover + Understand.
   - *Pending* = conversations in draft, rejected, awaiting a reply or a follow-up state.
   - *Opportunity* = sum of each recommended action's estimated extra contribution.
   - *Demo cases* are picked live from the engine's decisions: top reminder, top service recovery, top Understand, first on-rhythm Hold, first opted-out.
7. **Connections:** Directory, Recovery Decisions, Impact & Experiments.
8. **Implemented and tested:** all of the above (e2e checks: KPI values, priority links, demo cases, guide show / dismiss / persist / reopen).
9. **Simulated or assumed:** the opportunity figure is an estimate; the demo dataset is synthetic.
10. **Limitations:** the guide's dismissal is stored per browser.

### 4.2 Customer Directory (`/customers`, `src/app/customers/page.tsx`)

1. **Name:** Customer Directory.
2. **Purpose:** Find any customer and see their status and recommended action at a glance.
3. **What you see:** a table with Customer, Status, Main signal, Recommended action and **View case**; a "Complaint" tag when an unresolved complaint exists.
4. **What you can do:** search by ID; filter by decision (All / Needs action / Recover / Understand / Hold, with counts) and status; sort by priority, most overdue, longest since purchase, total spend or ID; page through 25 rows at a time.
5. **Data source:** customer profiles and Recovery Trial results.
6. **Rules:** "Main signal" = days since last purchase vs usual gap (`signalText`, `src/lib/present.ts`).
7. **Connections:** View case → Customer Insights.
8. **Tested:** search, decision filter (e2e).
9. **Simulated or assumed:** recommendations rest on editable estimates.
10. **Limitations:** search is by customer ID only (no names are stored, by design).

### 4.3 Customer Insights (`/insights` overview · `/insights?id=…` and `/customers/[id]` profile)

Customer Insights has two connected levels. The URL decides which one you see, so browser back/forward, the sidebar, the workflow bar and Copilot links all land correctly.

**A. Overview — `/insights`** (`src/components/InsightsOverview.tsx`, metrics in `src/lib/insights.ts`)

1. **Purpose:** understand the whole customer base, see who needs attention, and see what has been measured.
2. **Header:**
   - **Demo mode · Synthetic data** (or *Your uploaded data*) and the analysis date.
   - An **Active case** button that reopens the customer you were working on.
3. **Four KPIs**, each with a tooltip giving the definition and denominator:

| KPI | Definition | Type |
|---|---|---|
| Customers analysed | Customers with at least one valid purchase up to the analysis date | Observed **[Implemented]** |
| Customers requiring review | Recover + Understand decisions (same as the Command Centre) | Calculated **[Implemented]** |
| 90-day repeat-purchase rate | See the formula below; shows "Not available" if nobody is eligible | Calculated **[Implemented]** |
| Estimated contribution opportunity | Sum of the estimated extra contribution of every Recover/Understand action over the horizon. Not realised revenue. | Estimated / unvalidated **[Implemented]** |

4. **How are customers buying?** A line chart of **orders or revenue** (toggle).
   - Date range: **3M / 6M / 12M / All**. 3M and 6M use complete 7-day periods ending on the analysis date. 12M and All use calendar months; the current month is flagged as partial.
   - Empty periods show as zero. Axis labels and a tooltip give the period, orders, revenue and customer count.
   - The caption says a rise or fall is not evidence that a marketing action worked.
   - On the demo data, orders fall sharply from July to September 2026. The synthetic generator models customers lapsing; the counts match the Command Centre's monthly figures.
5. **Who needs attention?** A horizontal bar chart of Recover / Understand / Hold from the decision engine.
   - Clicking a bar, or the **Show Recover / Understand / Hold** buttons, filters the priority table.
   - Each bar has a text label as well as a colour. A plain-English key explains each decision and how many customers are blocked by consent or contact rules.
6. **Priority customers:** shows customer, main buying signal, decision, recommended action, evidence level, estimated extra contribution (not shown for Hold), contact eligibility and **View customer**.
   - Search by ID. Filter by Needs attention / Recover / Understand / Hold / All. 10 per page.
   - **Sort order:** Recover and Understand first, then by the estimated extra contribution of the recommended action, then ID. Past spend is not used.
   - **Contact eligibility** comes from the contact policy's result for each customer: *Allowed*, *Opted out*, *No consent*, *Consent not recorded*, *Contact limit reached* or *Declined — paused*.
   - On phones the table becomes a stacked list.
7. **Conversation journey:**
   1. **Needs attention now.**
   2. **Message drafted.** A Studio conversation exists. No percentage is shown, because someone drafted earlier can be on Hold today.
   3. **Approved · simulated send.** Shows the % of stage 2.
   4. **Simulated reply recorded.** Shows the % of stage 3 and a breakdown by reply.
   5. **Repeat purchase measured.** Experiment outcomes split into *observed*, *simulated* and *pending*. Pending outcomes are never counted.

   Stages 3–4 are labelled **Simulated**. No conversion rate is computed across stages that measure different groups.
8. **Repeat purchases and value:** each metric shows its formula and type.
   - **90-day repeat-purchase rate** (Calculated):
     - Eligible customers are those whose first purchase was at least 90 days before the analysis date.
     - A repeat is an order on a *later day* within 90 days of the first purchase. A second basket on the same day doesn't count.
     - Customers still inside their window are excluded and counted separately.
     - Demo: **79.1% (167 of 211)**, 7 excluded.
   - **Average order value** (Calculated): total order value ÷ number of orders in the selected date range. Order lines are grouped by order ID. Demo, 12 months: **$47.18**.
   - **Incremental contribution:**
     - From the latest experiment with recorded outcomes, using `computeImpact`. It is labelled *Simulated* if the outcomes were simulated.
     - Otherwise it reads **Not calculated**, with the imported campaign's difference and an explanation: those records have no cost or order-value data, and the group assignment can't be verified.
   - **Lifetime value is not predicted** — **[Planned]**.

**B. Customer profile — `/insights?id=…` or `/customers/[id]`** (`src/components/CustomerProfile.tsx`, unchanged route behaviour)

1. **What this means** (`whatThisMeans`, unit-tested):
   - The plain-English reading of the customer's own data: usual gap and its basis, current gap and ratio, spending change, recorded service interactions (with the complaint text if one is open), and whether contact is allowed.
   - If the gap is longer than usual, it ends with: "The data shows a change in buying behaviour, but it cannot establish why the customer has not returned." One-purchase customers are told there isn't enough history.
2. **Recommendation near the top:**
   - **Review recommendation** opens Recovery Decisions.
   - **Review message** opens Conversation Studio (not shown for Hold).
   - A short line explains each.
3. **Metrics:** the same four as before — days since last purchase, usual gap, versus own pattern, and spending change.
4. **Purchase timeline:**
   - x-axis *Purchase date*, y-axis *Order value ($)*. The tooltip shows the date and value, and marks unusually large orders and complaint orders when the data records them.
   - A sentence under the chart gives the usual and current gap. It explains that the comparison is with the customer's *own* past purchases.
5. **Profile:** consent, **contact eligibility** (new), category, typical order, total spend, evidence level, service interactions and previous recovery actions.
6. **Unchanged:** the four evidence layers, confidence and limitations, the gaps chart and the purchase history.
7. **What you can do:**
   - **All customers** returns to the overview.
   - The picker switches customer.
   - Opening a profile sets the Active case for every other page.

**Tested:**
- Unit tests (`tests/insights.test.ts`, 20 tests):
  - order grouping;
  - weekly and monthly periods, partial months, empty periods and future orders;
  - parity with the Command Centre's monthly counts;
  - repeat-rate eligibility, the window boundary, same-day orders and open windows;
  - decision counts, filters, search and ranking, including that it isn't ordered by spend;
  - contact eligibility for opt-out, no consent, unrecorded consent and contact limits;
  - journey subsets, simulated labels and pending outcomes;
  - the contribution source;
  - "What this means";
  - CSV import, demo reset and clear.
- Browser tests (`scripts/e2e.mjs` §3, §3b, §7):
  - the profile wording, gap line, axis labels and contact row;
  - overview KPIs and the demo label;
  - both charts render;
  - the range and measure toggles;
  - clicking a bar and the breakdown buttons filter the table;
  - an opted-out customer is shown as blocked;
  - View customer opens the right profile and sets the active case;
  - browser back returns to the overview;
  - journey counts after Studio actions, with simulated labels;
  - no overflow at 390 px.

**Limitations:**
- The repeat rate is measured after a customer's *first* purchase only.
- The trend shows activity, not cause.
- There is no cohort chart: with 218 customers, monthly first-purchase cohorts would mostly hold a handful of customers, too few for reliable rates.
- There is no lifetime-value chart, because a forecast would need validated retention and margin assumptions.
- Only the latest unresolved complaint drives decisions, and complaint severity isn't modelled.

### 4.4 Recovery Decisions (`/trial`, `src/app/trial/page.tsx`) — the Recovery Trial

1. **Name:** Recovery Decisions.
2. **Purpose:** Decide what to do for one customer — and whether it's worth it.
3. **What you see:**
   - **Context row:** purchase history, what changed, complaint on record, evidence.
   - **Recommendation panel:** recommended action, why, estimated value (with range and cost), how certain we are, what next.
   - **Four-step reasoning path:** what changed → evidence → decision → trade-off, each line labelled Observed / Calculated / Estimated.
   - **The three outcomes**, with the selected one marked.
   - **Expandable sections:**
     - *Compare alternative actions* — table and chart for no action, check-in, reminder, service recovery, benefit, discount.
     - *Adjust the estimates* — customer-only sliders, estimates for all customers, full calculation table.
     - *See why* — every reason and why each alternative was rejected.
     - *Customer records used.*
     - *How certain are we?*
     - *How it's calculated.*
4. **What you can do:**
   - pick a customer;
   - go to **Review message**;
   - change estimates and see the recommendation update instantly ("What-if mode");
   - **Save estimates for all customers**, which is logged in the audit trail;
   - discard the what-if.
5. **Data source:** profile + contact history + estimates (`src/lib/trial.ts`, `src/lib/policy.ts`).
6. **Rules and calculations:** sections 6–7.
7. **Connections:** Conversation Studio (Review message); Customer Insights; estimates are shared with Data & Integrations → Estimates.
8. **Tested:** recommendation shown; why / value / certainty / next step present; labels present; a slider change flips the decision live; discard restores it; contact limit after a send (e2e). Ranking and economics are unit-tested.
9. **Simulated or assumed:** lift, baseline chance and costs are editable assumptions, labelled *Estimated* and *Unvalidated*.
10. **Limitations:** heuristics, not a trained model; 90-day horizon by default.

### 4.5 Conversation Studio (`/studio`, `src/app/studio/page.tsx`)

1. **Name:** Conversation Studio.
2. **Purpose:** Write, approve and test the recovery message. Nothing is sent.
3. **What you see:** five steps (review customer context → review and edit the message → approve or reject → simulate customer response → next recommended action); message settings (tone, channel); the facts the message may use.
4. **What you can do:**
   - **Generate message** (template); **Regenerate message**; **Draft with AI** (only if a server key is set); edit the text.
   - Approve after ticking the review box. Approval is blocked while the claims check reports a problem.
   - Reject with a reason.
   - Simulate one of four replies.
   - Override a Hold to write a check-in (logged).
   - Reset the conversation.
5. **Data source:** the customer's record and Recovery Trial result (`src/lib/conversation.ts`); the optional API route `src/app/api/generate-message/route.ts`.
6. **Rules:**
   - The claims check blocks: a discount that wasn't recommended, an apology without a recorded complaint, a missing "Reply STOP" line, unfilled placeholders. It warns on pressure language, links and long SMS/WhatsApp.
   - Approving the first message records a simulated contact, which counts toward contact limits.
   - *Not interested* pauses contact for 90 days and never escalates to a discount.
   - *Has a service problem* switches the action to service recovery and escalates to a person.
   - *Needs more information* requires staff to write the factual answer.
7. **Connections:** contact limits feed back into Recovery Decisions (that customer is then held); approvals appear in Responsible AI & Audit.
8. **Tested:** placeholder and opt-out line in drafts; review gate; approve; service-problem path to escalation; rejection with reason; opted-out customer blocked (e2e); state transitions unit-tested.
9. **Simulated or assumed:** sends and replies are simulated and labelled.
10. **Limitations:** the live AI path has not been tested against the real API (no key was available).

### 4.6 Impact & Experiments (`/impact`, `src/app/impact/page.tsx`)

1. **Name:** Impact & Experiments.
2. **Purpose:** Show whether an action added value, and how reliable that evidence is.
3. **What you see:**
   - **Result selector:** REGAIN experiments and imported campaigns that include a comparison group.
   - **"What this means":** a plain-English sentence.
   - **Four metrics:** repeat-purchase rate for customers who received the action, rate for those who did not, difference in percentage points with its likely range, extra contribution.
   - **Comparison chart** with 95% ranges and sample sizes.
   - **"How reliable is this?"**
   - **"Was it worth the money?"**
   - **Expandable sections:** set up a new holdout experiment, assignments and outcome records, how the comparison works.
4. **What you can do:**
   - **Update the estimate with this result** (imported campaigns only).
   - Create an experiment: holdout share 10–50%, seed, window 7–180 days, with a power check.
   - **Measure from transactions.**
   - **Simulate outcomes (labelled).**
   - Record outcomes manually per customer.
   - Export assignments as CSV.
   - Delete an experiment (with confirmation).
5. **Data source:** imported contact history (`analyseHistorical`); experiments in app state (`src/lib/experiment.ts`).
6. **Calculations:** section 8.
7. **Connections:** calibrated estimates change every recommendation in Recovery Decisions; experiments appear in each customer's case progress.
8. **Tested:** evidence status shown; plain-English result does not claim cause; update estimate from result; experiment created with pending outcomes; simulated outcomes labelled (e2e); statistics unit-tested.
9. **Simulated or assumed:** "Simulate outcomes" draws from REGAIN's own estimates and is always labelled. Simulated results cannot update estimates.
10. **Limitations:** the demo has no future purchases, so new experiments stay pending unless outcomes are recorded or simulated. Imported campaigns can't be verified as randomised.

### 4.7 Data & Integrations (`/data`, `src/app/data/page.tsx`)

1. **Name:** Data & Integrations.
2. **Purpose:** Add customer data, check it, and set the rules REGAIN follows.
3. **What you see:** seven tabs.

   | Tab | Contents |
   |---|---|
   | Upload & validate | 1 Upload → 2 Map columns → 3 Check validation → 4 Import, for transactions and optional contact history |
   | Imported data | Source, counts, analysis date, and a paged table of all transaction lines |
   | Estimates | The same assumptions editor used in Recovery Decisions, plus the chance of buying without action, by status |
   | Consent & limits | Suppression counts and the contact-limit rules, with inline validation |
   | Integrations | An honest status list of what REGAIN connects to |
   | Business | Business name, benefit wording, analysis date |
   | Demo & reset | Load / reset demo data, sample CSV downloads, Clear all data (with confirmation) |

4. **What you can do:** import CSVs; fix column mapping and date format; download the sample, contacts and messy CSVs; reset; clear; save or discard settings.
5. **Data source:** your uploaded files (parsed in the browser) or the generated synthetic dataset.
6. **Validation rules** (`src/lib/csv.ts`):
   - **Required fields:** customer ID, date and value. Rows missing any of them are rejected.
   - **Dates:** invalid dates are rejected; ambiguous day/month dates are flagged.
   - **Values:** zero, negative and non-numeric values are rejected.
   - **Duplicates:** exact duplicate rows are removed.
   - **Order IDs:** an order ID already used by a different customer is rejected.
   - **Missing categories:** filled as "Uncategorised".
   - **Excluded columns:** sensitive attributes and direct identifiers are discarded and never stored.
   - **Limits:** 5 MB and 50,000 rows.
7. **Connections:** everything downstream recalculates on import or save.
8. **Tested:** messy CSV upload (personal-data columns discarded, 3 rejected, 1 duplicate), import, reset, inline validation, integrations list, imported-data table (e2e); CSV parsing unit-tested.
9. **Simulated or assumed:** the demo dataset is synthetic.
10. **Limitations:** no live connectors; data lives in browser storage only.

**Integrations — actual status:**

| Integration | Status |
|---|---|
| CSV upload | Available. This is the only data source. |
| Anthropic Messages API | Optional. Connected only if `ANTHROPIC_API_KEY` is set on the server. |
| Email / SMS / WhatsApp sending | Not built (by design). |
| Live store / CRM / database sync | Not built. |

### 4.8 Responsible AI & Audit (`/responsible`, `src/app/responsible/page.tsx`)

1. **Name:** Responsible AI & Audit.
2. **Purpose:** Show who may be contacted, what was approved, and what every decision was based on.
3. **What you see:**
   - **Six status tiles:** can be contacted; can't be contacted; message limits; messages checked (approved / rejected); data; AI writing on/off.
   - **Check a customer**, answering five questions: Can we contact them? Was a message approved? Why this suggestion? Is the result real or simulated? Numbers used.
   - **How REGAIN keeps things safe** (11 short rules).
   - **What REGAIN is built with** (libraries and data disclosure).
   - **What REGAIN can't do yet.**
   - **Activity log:** filter, export CSV, 20 rows per page.

   Wording on this page is written for someone new to REGAIN; detail sits in the ⓘ pop-ups.
4. **What you can do:** check any customer; filter and export the activity log.
5. **Data source:** policy results, conversations, experiments, contact history and the audit log (up to 500 entries).
6. **Rules:** `src/lib/policy.ts` (section 6).
7. **Connections:** links to Recovery Decisions and Data & Integrations → Estimates.
8. **Tested:** overview, customer check and audit entries render (e2e); consent and contact limits unit-tested.
9. **Simulated or assumed:** approvals record *simulated* sends.
10. **Limitations:** the audit trail is stored in the browser, not on a server.

### 4.9 Decision Copilot (**Ask REGAIN** button, every page; `src/components/Copilot.tsx`, `src/lib/copilot.ts`, `src/lib/copilotGuard.ts`, `src/app/api/copilot/route.ts`)

1. **Purpose:** a side panel for asking questions about REGAIN's *own* results. It is not a customer-service chatbot. It answers four kinds of question: *why did REGAIN decide this*, *what about another action*, *what changes if an assumption changes*, and *did the action create measurable value*.
2. **How to open it:** the **Ask REGAIN** button at the bottom right of every page. It opens a 440 px side panel (full width on a phone). The page stays visible behind it. **Escape** or **×** closes it. **New chat** clears the conversation. Conversations are not saved.
3. **Context:** the panel header shows **Customer C0053** (the active case, the same one as the *Active case* in the workflow bar, or the customer on `/customers/[id]`) or **All customers**. **Ask about all customers** switches to portfolio questions. Typing a real customer ID in a question (e.g. "Explain C0107") answers about that customer.
4. **Suggested questions** change with the page and the context:
   - for a customer: *Explain this recommendation*, *Compare it with doing nothing*, *Why not offer a discount?*, *What evidence is missing?* and *Draft a next-step plan*;
   - on Recovery Decisions, also *What if I reduce the discount to 10%?*;
   - *How does the complaint affect the options?* or *What if the customer had an unresolved complaint?*, depending on whether a complaint is recorded;
   - for the portfolio: *Who should I review first?*, *Why are customers being held?*, *Show customers with unresolved complaints*, *Summarise the latest experiment* and *Which decisions rely on the weakest evidence?*;
   - on Impact & Experiments: questions about chance, cost and sample size.
5. **The four capabilities. Every one is deterministic: figures come from the existing engine.**

| Capability | Example questions | What it does | Engine functions used |
|---|---|---|---|
| **Explain my decision** | "Why is this customer marked Recover?", "Why not give a discount?", "Why is this customer on Hold?", "What information are we missing?" | Restates the engine's decision and main reason. It then lists evidence labelled **Observed**, **Calculated**, **Possible explanation**, **Unknown**, **Estimated** and **Rule**. A recorded unresolved complaint is always shown with its effect on the options. With no complaint on record it says exactly that, and never infers unhappiness from inactivity. Customers with too little history are explicitly *not* treated as at risk. | `analyse`, `runTrial` results, `CustomerProfile.evidence`, `TrialResult.reasons/rejected/unknowns` |
| **Recovery Trial what-if** | "Compare it with doing nothing", "What if I reduce the discount to 10%?", "What if the reminder lift is 3%?", "What if the customer had an unresolved complaint?", "Which alternative has the best estimated incremental contribution?" | Shows a comparison card for each action: eligibility, estimated incremental contribution, its range, cost, the reason, and whether it depends on an unvalidated assumption. What-ifs are re-run through `runTrial` on a **copy** of the assumptions and labelled **What-if · not saved**. Supported changes: discount rate, an action's assumed lift, margin, horizon, and a hypothetical complaint. Anything else gets "I can't calculate that scenario safely". | `runTrial`, `analyse` (to count portfolio decisions a save would change) |
| **Portfolio investigator** | "Who should I review first?", "Which customers are being held because of consent?", "Find customers whose buying gap has changed significantly", "Which recommended actions have negative estimated contribution?", "Summarise the main reasons customers are being held." | Returns real counts plus at most 6 compact customer cards: ID, signal, decision, action, estimated value (only for non-Hold decisions) and reason. Each card has an **Open case** button. With no match, it says "No customers match … Checked all N analysed customers." | `Analysis.trials/byId/counts/suppressed`, `signalText`, `holdReason` |
| **Experiment & impact interpreter** | "Did this campaign work?", "Could this result be due to chance?", "Was the action worth its cost?", "What additional data would make this result more reliable?" | Gives treatment and control rates, the difference in percentage points, the 95 % interval, the p-value, the sample size, the sample needed for 80 % power, and contribution where available. The evidence is labelled **Simulated**, **Randomised holdout**, **Imported · assignment not verified** or **Awaiting outcomes**. An interval that includes zero is called *inconclusive*. Simulated outcomes are always called "SIMULATED … not real purchases". It never updates estimates; it points to the existing **Update the estimate** button. | `computeImpact`, `analyseHistorical` |

6. **Hard rules and safe actions:**
   - The Copilot does not approve, send, record, import or reset anything. If asked, it explains where to do it.
   - Requests to bypass consent, opt-out, declines or contact limits get the reply **Hard rules can't be changed here**. This covers "ignore the opt-out", "what if they had consent?" and "contact them anyway". A what-if always re-reads consent and limits from the real record.
   - The **only** change it can make is saving a what-if's assumptions. This takes two steps: **Save as my assumptions…** → **Confirm and save**. The confirmation shows the changes and how many customers' decisions would change.
   - The save goes through the existing `SET_ASSUMPTIONS` action and is written to the audit trail as "Decision Copilot (confirmed by user)". It is refused if the saved assumptions changed after the preview was calculated.
7. **Optional AI wording:**
   - **Status: [Implemented]. Not tested against the live API.** No key was available. Tested with mocked provider responses only.
   - With `ANTHROPIC_API_KEY` set on the server, the panel shows a checkbox, **Reword answers with external AI**. It is off by default.
   - When it is on, the browser sends **only** the answer's verified fact sentences to `/api/copilot`. Before sending, customer IDs are replaced with "Customer A", quoted text such as complaint wording is removed, and the request is capped at 24 facts of 280 characters each. No records, CSV, consent fields or other customers are sent.
   - The reply is validated on the server **and** in the browser. It is rejected if it contains a number not in the facts, claims proof or certainty, infers feelings, drops the word *simulated*, or exceeds 900 characters. A rejected reply is discarded, and REGAIN's own wording is shown with the reason.
   - Accepted wording is marked **AI-worded · checked** and can be switched back to REGAIN's wording.
   - Numbers in the evidence cards always come from the engine, never from the model.
   - Without a key, every answer is tagged **REGAIN engine**, and the panel says no AI provider is configured.
8. **Navigation:**
   - Answer buttons open **Recovery Decisions**, **Customer Insights**, **Conversation Studio** (only when contact is allowed), **Impact & Experiments**, **Customer Directory** or **Responsible AI & Audit**.
   - Customer links set the active case first, so the target page opens on that customer, including when that page is already open.
9. **Tested:**
   - Unit tests (`tests/copilot.test.ts`, 34 tests) cover:
     - Recover, Understand and Hold explanations;
     - insufficient history;
     - complaint present or absent;
     - consent and opt-out blocking;
     - bypass refusals;
     - what-ifs equal to direct `runTrial` output;
     - no mutation, and a stale-proof confirmation;
     - portfolio counts against `analyse`;
     - no-results answers;
     - inconclusive, positive, imported, simulated and pending experiments;
     - refusals to approve, send or reset;
     - links;
     - redaction of the facts sent to the model;
     - the validator;
     - the route with no key, malformed input, provider failures, unsupported output and accepted output.
   - The browser test (`scripts/e2e.mjs` §4b, plus checks in §8 and §11) covers:
     - opening the panel with context;
     - an explanation;
     - the no-AI disclosure;
     - a what-if that does not change `localStorage`;
     - the confirmation step;
     - the bypass refusal;
     - in-page navigation to another customer;
     - portfolio cards opening a case;
     - Escape to close;
     - simulated-outcome labelling;
     - phone width.
10. **Limitations:**
    - Questions are routed by keyword patterns, not by a language model. Unusual phrasings may get a generic explanation; the suggested questions are reliable.
    - It uses the **saved** assumptions. Unsaved slider changes on Recovery Decisions are not included, and the panel says so.
    - What-ifs are limited to the supported parameters.
    - Conversations are not saved.
    - "Buying gap changed significantly" uses a robust z ≥ 3 search filter. This is the Copilot's filter, not a decision rule.

### 4.10 Engagement & Journey (`/journeys`, sidebar → Recovery; `src/app/journeys/page.tsx`, model in `src/lib/journey.ts`)

1. **Purpose:** a read-only monitor that answers these questions:
   - Who has entered a recovery journey?
   - What was recommended, reviewed, approved and recorded?
   - What happened afterwards?
   - Who needs a person's attention next?

   It is **not an automation engine**. Nothing on the page sends, schedules or changes a contact. Selecting a customer only sets the shared active case.
2. **Data sources:**
   - The page derives everything deterministically from existing records:
     - transactions;
     - imported contact records;
     - Studio conversations;
     - the audit log;
     - experiments;
     - the current Recovery Trial decision.
   - No new state, database or scheduler was added.
   - Each event carries one of four source labels:

| Source | Meaning | Events |
|---|---|---|
| **Observed** | In the loaded data | Purchases, imported contacts, comparison-group membership, opt-outs in imported records, outcomes measured from transactions |
| **Recorded in REGAIN** | A person did it in the app | Draft created, draft rejected, message approved, Hold override, contact paused after a decline, experiment set-up, manually entered outcomes |
| **Simulated** | The prototype's simulation | Sends, customer replies, simulated experiment outcomes |
| **Calculated** | REGAIN's formulas | The day the buying gap passed 1.25× the customer's usual gap; the current decision |

   **Timestamps:**
   - Records have data dates.
   - App actions have the wall-clock time from the audit log.
   - **Drafts show "Time not recorded"**, because REGAIN doesn't store when a draft was created. No time is invented.
3. **Filters**, all applied to the KPIs, stages, journeys and tables:
   - search by customer ID or journey name;
   - activity date (last 30 / 90 / 365 days of journey events);
   - journey status;
   - recovery action;
   - event type;
   - outcome;
   - data mode (observed or recorded / simulated);
   - **Clear filters**.

   Clicking a step or a journey's **Show customers** button adds a removable filter.
4. **KPIs**, all in unique customers. Contact *records* appear only as a separate, labelled count.

| KPI | Definition | Demo (fresh reset) |
|---|---|---|
| Customers contacted | Customers with ≥1 contact record (simulated send, or treatment record in imported data). Comparison-group records are not contacts. | 73 customers (0 simulated, 73 imported; 78 contact records) |
| Customers who responded | Simulated Studio reply, or opt-out in imported records. No record doesn't mean the message was ignored. | 1 (an imported opt-out) |
| Purchased within 30 days of contact | Order within 30 days after the customer's **latest** contact ÷ contacted customers whose window has ended. Open windows are excluded. | 75.4% (49 of 65; 8 still in window) |
| Need your review | Rule-based next step is a person's review | 61 |
| Can't be contacted | No consent, unsubscribed, said no, or messaged recently | 35 |

5. **Steps** (counts of unique customers; the page uses plain labels):
   1. **Suggested:** Recover/Understand now, or a message started from a suggestion.
   2. **Message written.**
   3. **Checked:** a message was approved or rejected.
   4. **Approved.**
   5. **Contacted.**
   6. **Replied.**
   7. **Bought again.**

   Each stage needs its own record: drafted ≠ approved ≠ sent ≠ replied. A share of the previous stage is shown **only after the code checks that every customer in the stage also passed the previous one**. On the demo, imported contacts never went through REGAIN's approval, so "Contacted" shows no share, and the info icon explains why.
6. **Journeys** (a derived view, not live automations):
   - **REGAIN journeys:** one per recovery action. A customer's primary journey is, in order of preference:
     1. the action of their first simulated send;
     2. their draft's action;
     3. the current recommendation.

     These journeys count **only REGAIN's own contacts**. Imported contacts are credited to their campaign.
   - **Hold groups:** "blocked by rules" and "no contact needed".
   - **Imported campaigns:** shown with their holdout. The outcome is measured from the campaign's own contact date (May-26: 53 of 70 treated customers bought within 30 days).
   - **Holdout experiments:** outcomes split into observed / simulated / pending.

   The table can be sorted, has 8 journeys per page, and each row has **Show customers**.
7. **Customer activity:** one row per customer, showing decision, recommended action, stage reached, last activity, latest response or outcome, contact eligibility, **next review step**, **Timeline** and **View**.
   - The next step is rule-based. Hard rules come first: a blocked customer always gets "No further contact — …", or "Do not approve the draft — …" if a draft exists.
   - The default sort is *needs review first*.
8. **Timeline:** a chronological list of every event, each with its source label and related journey. Purchases are shown from 90 days before the first journey event. It links to the customer profile, Recovery Decisions and Conversation Studio.
9. **Outcomes after contact**, each with its definition:
   - **Purchase within 30 days** (observed): split by imported vs REGAIN contacts. A simulated send is dated the analysis date, so its window is always still open.
   - **Median days from contact to next purchase** (observed): 12 on the demo.
   - **Average qualifying order** (observed): $42.63.
   - **Opt-out after contact** (observed): 1 of 73.
   - **Causal lift**, taken from Impact & Experiments, not recalculated here: +9.5 pp, inconclusive.
   - **Estimated contribution** of current recommendations.

   The page states that a purchase after contact is not a purchase caused by it.
10. **Not measured:**
    - message deliveries, opens or clicks (there is no messaging integration);
    - real customer replies;
    - when a draft was created;
    - recurring automations — **[Planned]**, not built.
11. **Tested:**
    - **Unit tests** (`tests/journey.test.ts`, 21 tests):
      - stage derivation (drafted ≠ approved ≠ responded);
      - imported contacts don't imply approval, and holdout records aren't contacts;
      - shares appear only when one stage is a subset of the previous;
      - unique customers vs contact records;
      - windows: purchase, no purchase, outside the window, still open;
      - parity with the sample campaign's own flags;
      - timeline ordering, including approval → send → reply;
      - no invented timestamps;
      - source labels;
      - experiment outcomes, with pending never counted;
      - opt-out, consent and contact-limit blocking;
      - "not interested" pausing contact;
      - building the view never changes state;
      - journey assignment and attribution to REGAIN vs imported contacts;
      - every filter, sorting, empty data, demo reset and CSV import.
    - **Browser tests** (`scripts/e2e.mjs` §7b, 13 checks):
      - the page is in the sidebar and loads;
      - funnel counts after Studio actions;
      - KPI units;
      - the imported journey row;
      - stage filter;
      - timeline order and simulated labels;
      - next steps for blocked and rejected customers;
      - search, Show customers and Clear filters;
      - outcome wording;
      - navigation to the profile;
      - no overflow at 390 px.
12. **Limitations:**
    - Event history is reconstructed from the audit log (kept up to 500 entries), so very old app actions may be missing.
    - A customer's REGAIN journey is a single primary journey.
    - At 1280 px wide, the two large tables scroll sideways inside their cards.

---

## 5. Behaviour indicators (`src/lib/behaviour.ts`)

| Indicator | Calculation |
|---|---|
| Purchases | Lines grouped by order ID (or customer + date). Same-day orders = one visit. |
| Days since last purchase | Analysis date − last purchase date. |
| Usual gap | Median of the gaps between purchase dates. |
| Pattern source | ≥ 2 gaps = personal; 1 gap = provisional; 0 = not enough history. |
| Versus own pattern | Days since last purchase ÷ usual gap. |
| Status | < 1.25× buying as usual · < 2× slipping · < 4× lapsed · ≥ 4× dormant. One-purchase customers are "new" (recent) or "insufficient history". |
| Robust z-score | (current gap − median) ÷ max(1.4826 × MAD, 0.2 × median, 3 days). |
| Regularity (CV) | 1.4826 × MAD ÷ median. Below 0.5 counts as regular. |
| Typical order | Median order value. Unusually large orders are flagged and ignored. |
| Spending change | (last 182 days − previous 182 days) ÷ previous. |
| Evidence score | min(purchases, 8)/8 × 0.5 + regularity (0.3/0.2/0.1) + category 0.1 + consent recorded 0.1. High ≥ 0.7, medium ≥ 0.45. It measures how much data exists, **not** the chance of success. |

---

## 6. How the decision is made (`src/lib/trial.ts`, `src/lib/policy.ts`)

The rules are checked in this order:

1. **Hard rules → Hold** if any of these apply:
   - opted out (in the data, or after a past contact);
   - consent not "yes" (missing consent counts as no consent);
   - declined in the Studio within 90 days;
   - contacted fewer than 14 days ago;
   - 2 or more contacts in the last 90 days.
2. **Evidence → Hold** if there is only one purchase, or the customer is buying as usual.
3. **Cause unclear → Understand.** If there is no recorded complaint and no regular repeat pattern, recommend a check-in, provided the check-in's estimated extra contribution is ≥ $0. Otherwise Hold.
4. **Cause evidenced → Recover.** Choose the best eligible action. Service recovery comes first when a complaint is open and it isn't loss-making. If the best action is below the $0.75 minimum, Hold.

Adjustments to each action's lift:

- Service recovery is not allowed without a recorded complaint.
- Without a regular pattern, the reminder's lift is multiplied by 0.35.
- With an unresolved complaint, promotional actions get half the lift and three times the opt-out risk.
- Lift by status: buying as usual × 0.3, slipping × 1, lapsed × 0.8, dormant × 0.4, new × 0.6.

---

## 7. Financial formulas and worked examples

```
p0  = chance of buying without action (as usual 65%, slipping 40%, lapsed 20%, dormant 7%, new 30%)
u   = estimated lift × adjustments
p_a = min(0.95, p0 + u)
N   = clamp(90 ÷ usual gap, 1, 3)       (1 without a personal pattern)
Revenue      = p_a × N × typical order
Contribution = Revenue × margin (45%)
Cost         = message/staff + p_a × benefit + p_a × discount × order + opt-out risk × $25
Extra contribution = (Contribution − Cost) − (p0 × N × order × margin)
Range: lift ±50% (high evidence), ±75% (medium), ±100% (low), +25 points without a personal pattern
```

Default estimates (all editable):

| Action | Lift | Message / staff cost | Other cost | Opt-out risk |
|---|---|---|---|---|
| Check-in | +4 pp | $0.50 | — | 0.4% |
| Reminder | +7 pp | $0.30 | — | 0.8% |
| Service recovery | +15 pp | $3.00 | — | 0.2% |
| Benefit | +6 pp | $0.50 | $2.50 if used | 0.6% |
| Discount | +10 pp | $0.30 | 15% of the order | 1.0% |

**C0053 — reminder (Recover).** Slipping, so p0 = 0.40. N = 3 (usual gap 21 days). Typical order $48.69.

| Step | Value |
|---|---|
| p_a | 0.47 |
| Revenue = 0.47 × 3 × 48.69 | $68.65 |
| Contribution | $30.89 |
| Cost = 0.30 + 0.008 × 25 | $0.50 |
| Doing nothing | $26.29 |
| **Extra contribution** | **$4.10** (range $1.80 to $6.40) |

For comparison, a discount costs $3.65, of which **$2.92** goes to customers likely to buy anyway, leaving **$2.37**.

**C0107 — service recovery (Recover).** Unresolved "Late delivery". Service recovery **$6.95**; discount **−$1.05**; reminder $1.43.

**C0122 — check-in (Understand).** Irregular buyer with no complaint. Check-in **$0.56** (range −$0.02 to $1.13); discount −$2.12.

**Totals on the demo data:** 68 Recover, 15 Understand, 135 Hold; 35 customers blocked by rules. The estimated opportunity is **$192** — an estimate, not a result.

---

## 8. Customers who did and did not receive the action (`src/lib/experiment.ts`)

- **Assignment:** a hash of "seed :: customer ID" decides who is held out. This is random but reproducible.
- **Outcomes:**
  - **Measured** from new transactions inside the window. Customers still inside the window stay *pending* and are never counted as recoveries.
  - **Manual**, recorded per customer.
  - **Simulated**, always labelled.
- **Statistics:**
  - Wilson 95% interval per group;
  - Newcombe interval for the difference;
  - two-proportion z-test;
  - sample size per group for 80% power.
- **Extra contribution** = (revenue per customer who received the action − per customer who didn't) × number who received it × margin − contact/benefit costs − discounts paid.
- **Demo campaign (May-26 reminder test, synthetic):** 75.7% (53/70) vs 66.2% (47/71) = **+9.5 pp**, likely range −5.5 to +23.9 pp, p = 0.213. The range includes zero, so this could be chance; about 354 per group would be needed. REGAIN says this on screen.

---

## 9. Observed, calculated, estimated, simulated

| Item | Type |
|---|---|
| Transactions, complaints, consent, past campaign outcomes | **Observed** (synthetic in the demo) |
| Usual gap, days since purchase, status, z-score, spending change, evidence score | **Calculated** |
| Chance of buying, lift, extra contribution, costs, ranges | **Estimated**, and **Unvalidated** until tested |
| Studio sends and replies; "Simulate outcomes" | **Simulated** |
| Demo dataset (218 customers, "Kopi & Co. Roasters") | **Synthetic**, seed 2026 |

---

## 10. Responsible AI safeguards

- **Data:**
  - Synthetic data by default.
  - Sensitive attributes (gender, age, race, religion, health, income…) and direct identifiers (names, emails, phones, addresses) are discarded at import.
  - Messages use a `{first_name}` placeholder instead of stored names.
- **Contact rules:**
  - Missing consent = no contact; opt-outs are always respected.
  - A "not interested" reply pauses contact for 90 days and never leads to a discount.
  - Contact limits are hard rules: 14 days minimum gap, 2 contacts per 90 days.
- **Messages:**
  - Human review is required before approval.
  - The claims check blocks unsupported statements.
- **Security:**
  - CSV input is sanitised and size-capped; exports are protected against spreadsheet formula injection.
  - The AI key is read on the server only, and no customer ID is sent to the AI.
- **Honesty and records:**
  - Estimates and simulations are labelled everywhere; simulations can't update estimates.
  - The audit trail records data loads, estimate changes, overrides, approvals, rejections, replies, suppressions and experiments.

---

## 11. Technology and architecture

- **Next.js 15 (App Router) + React 19 + TypeScript**, **Tailwind CSS 3** (tokens in `tailwind.config.ts`), **Recharts 2** (charts), **Papa Parse 5** (CSV), **Vitest 3** and **puppeteer-core** (tests).
- `src/lib/` — pure logic:
  - `csv` — import and validation;
  - `behaviour` — profiles and indicators;
  - `policy` — consent and contact rules;
  - `trial` — the Recovery Trial;
  - `conversation` — drafting, claims check, conversation states;
  - `experiment` — groups, outcomes, statistics;
  - `sampleData` — the synthetic dataset;
  - `store` — app state and audit log;
  - `analysis` — runs everything on the loaded data;
  - `present` — wording only.
- `src/components/` — shared components:
  - `AppProvider` — state, saved in `localStorage` and flushed when the page is hidden;
  - `Shell` — navigation, workflow bar, active case;
  - `ui` — design system;
  - `CustomerProfile`, `CaseBar`, `Onboarding`, `AssumptionsForm`, `chartTheme`.
- The only server code is the optional AI route.

```
CSV / demo data → csv.ts → store → analysis.ts → behaviour.ts → policy.ts → trial.ts
  → Conversation Studio (conversation.ts) → Impact & Experiments (experiment.ts) → estimates updated
```

---

## 12. Limitations

- Heuristic estimates, not a trained model.
- Purchases made elsewhere are invisible.
- Only the latest open complaint is considered.
- Refunds are rejected at import, not netted off.
- Browser storage only: no multi-user access, no live integrations, no real messaging.
- Calibration uses the observed difference even when the campaign window differs from the 90-day horizon.
- Decision Copilot routes questions by keyword patterns. It uses the saved assumptions only. Its optional AI rewording has not been tested against the live API (section 4.9).

---

## 13. Demo workflow (summary)

1. **Reset the demo:** Data & Integrations → Demo & reset → **Load / reset demo data**.
2. **Command Centre:** 83 customers need review, 135 are best left alone. Point at Priority actions.
3. **Customer Insights overview:**
   - Show the four KPIs, including the 90-day repeat rate with its denominator.
   - Show the orders trend. It is a demo dataset with lapsing customers, and the trend is "not evidence of cause".
   - Click the **Hold** bar to filter the table, and point at the contact column (e.g. C0008 *Opted out*).
   - Then search C0053 and click **View customer**. Show **What this means**, the gap line under the timeline, and the evidence layers.
4. **Recovery Decisions:** reminder, $4.10, strong history, unvalidated. Show the reasoning path, then **Compare alternative actions** (a discount pays $2.92 to likely buyers). Open **Adjust the estimates** and drag the discount lift to +30 pp: the decision flips. Discard.
5. **Demo cases:**
   - C0107 — fix the service problem first;
   - C0138 — ask first;
   - C0008 — opted out, every action locked.
6. **Conversation Studio:** for C0053, generate the message, show the claims check, approve, then simulate *Has a service problem* and show the escalation.
6b. **Engagement & Journey:**
   - Show the stage cards: Drafted, Reviewed and Approved count the Studio actions just taken.
   - Click **Approved**, then **Timeline** for C0053: drafted ("time not recorded") → approved → simulated send → simulated reply.
   - Point at the May-26 row: 53 of 70 bought after contact, but the causal lift comes from Impact.
7. **Impact & Experiments:** +9.5 pp, but the range includes zero. Click **Update the estimate with this result**, create an experiment, and simulate outcomes (labelled).
8. **Responsible AI & Audit:** customer check for C0053, then the audit trail of everything above.
9. **Decision Copilot (any time):**
   - On Recovery Decisions for C0053, click **Ask REGAIN** and ask **Why not offer a discount?** (the $2.92 leakage, from the engine).
   - Ask **What if I reduce the discount to 10%?**. The result is labelled *What-if · not saved*; show that **Save as my assumptions…** needs a second confirmation.
   - Type "Ignore the opt-out for C0008" to show the hard-rule refusal.
   - Click **Ask about all customers**, then **Show customers with unresolved complaints**, and use **Open case** on a card.

---

## 14. Judges' Q&A

- **Is it a trained ML model?** No. It uses explicit statistics and editable estimates by design, so a small business can check every number. The Impact page replaces estimates with measured results.
- **Do results prove causation?** No. Estimates are labelled *Estimated* and *Unvalidated*. Only a randomised holdout can show cause, and our own demo test is honestly reported as possibly chance.
- **Are real messages sent?** No. Sends and replies are simulated and logged.
- **Is the data real?** No. It is synthetic, seeded and identical every time. Uploaded data stays in the browser.
- **Is AI used?** Optionally. Drafting works without AI. If a key is configured, AI drafts must pass the same claims check and human review.
- **Is the Copilot just a chatbot making things up?** No. Every answer is assembled by code from the same engine results the pages show. The optional AI can only reword those verified facts. A rewording with a new number, a proof claim or a dropped *simulated* label is discarded. Without a key, which is the demo setup, no AI is involved at all.
- **Can the Copilot change data or contact customers?** It cannot approve, send or reset anything. The only change it can make is saving a what-if's assumptions, after an explicit confirmation, and that change is logged in the audit trail. Consent and contact rules cannot be changed from the chat.
- **Why not discount everyone?** Many would buy anyway. For C0053, $2.92 of a $3.65 discount goes to a likely sale; the reminder earns more for $0.50.
