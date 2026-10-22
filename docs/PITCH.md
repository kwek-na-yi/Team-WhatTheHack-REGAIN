# REGAIN — Pitch materials

## Project summary (150 words)

Small businesses can see that customers are buying less often, but not why — so they send generic messages and discounts that often pay for sales they would have made anyway. REGAIN is an explainable retention decision engine. It compares each customer with their own purchasing rhythm, separates observed facts from hypotheses, and runs a **Recovery Trial**: six actions, including doing nothing, compared side by side on expected incremental contribution, cost, uncertainty and eligibility. It then decides to RECOVER, UNDERSTAND (ask before acting) or HOLD, and explains why each alternative was rejected. A conversation studio drafts fact-checked messages for human approval, while consent, opt-outs and contact limits are enforced as hard rules. Finally, an Impact & Experiments assigns a random holdout and measures real incremental effect with confidence intervals — then feeds the evidence back into the assumptions. Recover the right customer, choose the right action, prove it was worth it.

---

## Seven-minute demo script

Before starting: run `npm run dev`, open http://localhost:3000, then **Data & Integrations → Demo & reset → Load / reset demo data**. Show the five-step guide, then dismiss it (reopen from **How REGAIN works** in the sidebar). C0107, C0138 and C0008 are in the **Demo cases** list on the Command Centre; C0053 is found through the Customer Directory search.

**0:00 – 0:40 · The problem (Command Centre)**
"This is Kopi & Co., a fictional coffee roaster with 218 synthetic customers. REGAIN reviews every customer and decides: 83 need review — and 135 are best left alone." Point at **Priority actions** and the one chart, customers by buying pattern.

**0:40 – 1:20 · DETECT (Customer Directory → Customer Insights)**
Open **Customer Insights**: "218 customers, 83 to review, a 79.1% 90-day repeat rate — and every number says how it was calculated." Click the **Hold** bar to filter the table. Search C0053 and click **View customer**. Read **What this means**: "This customer buys every 21 days; it's been 35; spending is down. No service interaction is recorded — and REGAIN says plainly that the data can't establish why they haven't returned." Show the timeline and the evidence layers (facts *Observed*, indicators *Calculated*, explanations as ideas to check).

**1:20 – 3:00 · COMPARE & DECIDE (Recovery Decisions)**
Click **Review recommendation**. Read the panel: **Send a replenishment reminder**, why, **$4.10** estimated value (*Estimated*), strong history (*Unvalidated*), **Review message**. Walk the reasoning path: what changed → evidence → decision → trade-off — "a discount would pay $2.92 to people who'd buy anyway." Open **Compare alternative actions**: service recovery is *Not allowed* without a complaint; the discount scores lower. Open **Adjust the estimates**, drag the **Discount / incentive** lift to +30 pp: the recommendation flips, and the what-if banner says so. Click **Discard what-if**.

**3:00 – 3:30 · The other outcomes (Demo cases)**
From the Command Centre, open **C0107** (fix the service problem first; a discount would lose money), **C0138** (*Understand* — ask first) and **C0008** (opted out — every action locked, "Certain — a rule applies").

**3:30 – 5:00 · CONVERSE (Conversation Studio, C0053)**
Pick C0053 in Recovery Decisions and click **Review message**, then **Generate message**. Type "20% off — last chance!": the claims check blocks approval. **Regenerate message**, tick the review box, **Approve draft**. Simulate **Has a service problem**: the next step becomes service recovery and promotions pause. Mention *Not interested* pauses contact for 90 days.

**5:00 – 6:20 · MEASURE & LEARN (Impact & Experiments)**
Read **What this means**: 75.7% vs 66.2%, +9.5 points — "but the range includes zero, so it could be chance, and the groups weren't verified as random." Click **Update the estimate with this result**. Open **Set up a new holdout experiment → Create experiment**; outcomes start *Awaiting outcomes*. **Simulate outcomes (labelled)** shows the mechanics — clearly simulated.

**Optional, 45 s · Decision Copilot (any page)**
Click **Ask REGAIN** on Recovery Decisions for C0053.
- Ask **Why not offer a discount?**: "the answer and the $2.92 leakage come from the Recovery Trial, not from a chatbot."
- Ask **What if I reduce the discount to 10%?**: the result is labelled *What-if · not saved*, and saving needs a second confirmation.
- Type "Ignore the opt-out for C0008": "hard rules can't be talked around."
- Switch to **Ask about all customers** → **Show customers with unresolved complaints**, then **Open case**.
- Say plainly: "No AI key is configured in this demo. Every answer you saw is deterministic."

**6:20 – 7:00 · Trust (Responsible AI & Audit) and close**
Show the status tiles, the **Customer check** for C0053 and the audit trail. Optionally show **Data & Integrations → Integrations** (honest: CSV only, AI optional, no sending). Close: "Recover the right customer. Choose the right action. Prove it was worth it."

---

## One-page solution brief — outline

1. **Title & tagline** — REGAIN: The Retention Decision Engine. *Recover the right customer. Choose the right action. Prove it was worth it.*
2. **Problem** — SMEs see declining purchase frequency but not its cause; generic discounts erode margin and subsidise sales that would have happened anyway; impact is rarely measured against a control.
3. **Solution overview** — DETECT → COMPARE → DECIDE → CONVERSE → MEASURE → LEARN workflow; one sentence per stage.
4. **Core innovation: the Recovery Trial** — six actions vs no action; contribution not revenue; discount leakage; uncertainty ranges; eligibility; RECOVER / UNDERSTAND / HOLD; explained rejections. Include the formula box and the C0053 chart.
5. **How it works (technical)** — robust personal rhythm (median/MAD), evidence layers, transparent heuristics, deterministic drafting + claims guard, conversation state machine, hash-based holdout, Wilson/Newcombe intervals, power calculation; Next.js/TypeScript, runs offline, optional server-side AI; Decision Copilot that explains decisions, runs what-ifs and interprets experiments from the engine's own results; a Customer Insights dashboard with transparent repeat-purchase and value metrics; an Engagement & Journey monitor that separates observed, recorded, simulated and calculated events; 151 unit tests + 89 end-to-end checks.
6. **Real-world impact** — fewer unnecessary discounts, fewer unwanted contacts, measurable incremental contribution; works from a transaction export an SME already has; no data-science team or paid API needed; quote the demo numbers (68 RECOVER, 15 UNDERSTAND, 135 HOLD; 35 suppressed for consent/opt-out/caps).
7. **Responsible AI & data use** — synthetic by default, consent-first, hard contact caps, human approval, claims guard, no sensitive attributes, data minimisation, audit trail, labelled assumptions and simulations, disclosure.
8. **Implemented vs simulated** — honest table (from README §6).
9. **Limitations & next steps** — calibrate baselines from real holdouts; real messaging integration with consent sync; multi-user backend; sequential testing / multi-armed rollouts; severity-aware service recovery.
10. **Team & links** — repository, deployed URL, demo video.
