// End-to-end regression test of the main flows in a real (headless) browser.
// Usage: start the app (npm run dev, or npm run build && npm start), then: npm run e2e
// Env: BASE_URL (default http://localhost:3000), BROWSER_PATH (Chrome/Edge executable).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const candidates = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error("No Chrome/Edge found. Set BROWSER_PATH.");

const results = [];
const pageErrors = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-first-run"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));

const text = () => page.evaluate(() => document.body.innerText);
const waitText = (t, timeout = 10000) => page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const clickButton = async (label) => {
  const ok = await page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim().startsWith(l) && !x.disabled);
    if (b) b.click();
    return !!b;
  }, label);
  if (!ok) throw new Error(`Button not found or disabled: ${label}`);
  await new Promise((r) => setTimeout(r, 250));
};
const openDisclosure = (title) =>
  page.evaluate((t) => {
    const d = [...document.querySelectorAll("details")].find((x) => x.querySelector("summary")?.innerText.includes(t));
    if (d) d.open = true;
    return !!d;
  }, title);
const go = async (p) => {
  await page.goto(BASE + p, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !document.querySelector("[aria-label=\"Loading customer data\"]") && !document.body.innerText.includes("Loading…"), { timeout: 20000 });
};
const tick = (label) => page.click(`input[aria-label="${label}"]`);

try {
  // 1. Reset to demo data
  await go("/data#reset");
  await clickButton("Load / reset demo data");
  check("Reset loads synthetic demo data", await waitText("Synthetic demo data loaded"));

  // 2. Command Centre: derived KPIs and priority list
  await go("/");
  const home = await text();
  check("Command Centre KPIs derive from data", /customers requiring review\s*\n\s*83/i.test(home) && /customers analysed\s*\n\s*218/i.test(home));
  const reviewLinks = (await page.$$('a[href^="/trial?id="]')).length;
  check("Priority customers list renders with review links", home.includes("Priority actions") && reviewLinks >= 5, `links=${reviewLinks}`);
  check("Demo mode offers contrasting cases (recover, service, unclear, do nothing, blocked)", ["Recovery action", "Service problem", "Unclear cause", "Do nothing", "Contact not allowed"].every((c) => home.toUpperCase().includes(c.toUpperCase())));
  check("First-time guide is shown", home.includes("How REGAIN works — five steps"));
  await clickButton("Dismiss guide");
  await go("/");
  check("Dismissed guide stays dismissed after reload", !(await text()).includes("How REGAIN works — five steps"));
  await go("/?guide=1");
  check("Guide can be reopened from the sidebar link", (await text()).includes("How REGAIN works — five steps"));

  // 3. Customers: search, filter, detail
  await go("/customers");
  await page.type('input[placeholder="Search ID"]', "C0053");
  check("Search filters the customer list", await waitText("1 customers"));
  await page.evaluate(() => { const i = document.querySelector('input[placeholder="Search ID"]'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); });
  await clickButton("Hold");
  const holdRows = await page.$$eval("tbody tr", (rows) => rows.every((r) => /hold/i.test(r.innerText) && !/recover|understand/i.test(r.innerText)));
  check("Decision filter shows only Hold customers", holdRows);
  await go("/customers/C0053");
  check("Customer detail opens with timeline and evidence", (await waitText("Purchase timeline")) && (await text()).includes("See why — the evidence"));
  check("Customer case progress is shown", (await text()).toUpperCase().includes("CONVERSATION") && (await text()).toUpperCase().includes("OUTCOME"));
  await go("/studio");
  check("Selected customer carries over to the Studio without searching", await waitText("C0053"));
  await go("/insights?id=C0053");
  check("Customer profile explains what the data means in plain English", (await waitText("What this means")) && (await text()).includes("Customer C0053") && (await text()).includes("cannot establish why the customer has not returned"));
  check("Profile shows usual vs current gap against the customer's own rhythm", (await text()).includes("Compared with this customer's own past purchases") && (await text()).includes("Order value ($)"));
  check("Profile shows contact eligibility and links to the next step", /Contact eligibility\s*\n?\s*Allowed/.test(await text()) && (await page.$('a[href="/trial?id=C0053"]')) !== null);

  // 3b. Customer Insights overview: KPIs, trend, decision breakdown, priority table, navigation
  await go("/insights");
  const ov = await text();
  check("Insights overview shows demo label and derived KPIs", ov.includes("Demo mode · Synthetic data") && /customers analysed\s+observed\s+218/i.test(ov) && /customers requiring review\s+calculated\s+83/i.test(ov));
  check("Repeat-purchase rate shows a value with its denominator", /90-day repeat-purchase rate\s+calculated\s+\d+(\.\d)?%/i.test(ov) && /\d+ of \d+ customers bought again/.test(ov));
  check("Overview keeps the active customer one click away", ov.includes("Active case C0053"));
  check("Purchase trend and decision charts render", (await page.$$(".recharts-line-curve")).length === 1 && (await page.$$(".recharts-bar-rectangle")).length === 3);
  await clickButton("3M");
  check("Date range switches the trend to weekly periods", await waitText("per week, last 3 months"));
  await clickButton("Revenue");
  check("Measure toggle switches the trend to revenue", await waitText("Revenue ($)"));
  const rowDecisions = () => page.$$eval('table[aria-label="Priority customers"] tbody tr', (rows) => rows.map((r) => r.children[2].innerText.trim().toUpperCase()));
  check("Priority table defaults to Recover and Understand only", (await rowDecisions()).every((d) => d === "RECOVER" || d === "UNDERSTAND"));
  const bars = await page.$$(".recharts-bar-rectangle");
  await bars[2].click();
  await new Promise((r) => setTimeout(r, 300));
  check("Clicking the Hold bar filters the table to Hold", (await rowDecisions()).length > 0 && (await rowDecisions()).every((d) => d === "HOLD"));
  await clickButton("Show Understand");
  check("Breakdown buttons filter the table (Understand)", (await rowDecisions()).length > 0 && (await rowDecisions()).every((d) => d === "UNDERSTAND"));
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Decision filter"] [role="radio"]')].find((b) => b.innerText.startsWith("All")).click());
  await page.type('input[aria-label="Search priority customers"]', "C0008");
  check("Opted-out customer is shown as not contactable", await page.waitForFunction(() => { const c = document.querySelector('tr[data-customer="C0008"] [data-contact]'); return c && c.getAttribute("data-contact") === "blocked" && c.innerText.includes("Opted out"); }, { timeout: 5000 }).then(() => true, () => false));
  await page.evaluate(() => document.querySelector('tr[data-customer="C0008"] button').click());
  check("View customer opens that customer's profile", await page.waitForFunction(() => location.search === "?id=C0008" && document.body.innerText.includes("Customer C0008") && document.body.innerText.includes("What this means"), { timeout: 8000 }).then(() => true, () => false));
  check("Opened customer becomes the active case", await waitText("Active case C0008"));
  await page.goBack();
  check("Browser back returns to the overview", await page.waitForFunction(() => location.search === "" && document.body.innerText.includes("Priority customers"), { timeout: 8000 }).then(() => true, () => false));
  check("Journey and measurement sections are labelled honestly", (await text()).includes("Conversation journey") && (await text()).includes("Lifetime value is not predicted") && (await text()).includes("Not calculated"));

  // 4. Recovery Trial: recommendation first, simulator updates live
  await go("/trial?id=C0053");
  check("Trial leads with the recommendation", await waitText("Send a replenishment reminder"));
  const tr = (await text()).toUpperCase();
  check("Trial answers why, value, certainty and next step", ["RECOMMENDED ACTION", "WHY?", "ESTIMATED VALUE", "HOW CERTAIN ARE WE?", "WHAT NEXT?"].every((q) => tr.includes(q)));
  check("Decision path labels facts vs estimates", tr.includes("OBSERVED") && tr.includes("CALCULATED") && tr.includes("ESTIMATED"));
  await openDisclosure("Adjust the estimates");
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Discount / incentive"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "0.3");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  check("Changing an assumption updates the decision live", await waitText("What-if mode"));
  check("Large discount uplift flips the recommendation", (await text()).includes("Offer a discount"));
  await clickButton("Discard what-if");
  check("Discarding restores the engine's recommendation", !(await text()).includes("What-if mode") && (await text()).includes("Send a replenishment reminder"));

  // 4b. Decision Copilot: grounded answers, isolated what-ifs, confirmation, navigation, hard rules
  await go("/trial?id=C0053");
  await clickButton("Ask REGAIN");
  check("Copilot opens with the active customer as context", await page.waitForFunction(() => document.querySelector('[data-testid="copilot-context"]')?.innerText === "Customer C0053", { timeout: 5000 }).then(() => true, () => false));
  check("Copilot offers suggested questions for the case", (await text()).includes("Why not offer a discount?"));
  await clickButton("Explain this recommendation.");
  check("Copilot explains the engine's decision with evidence labels", (await waitText("C0053 is marked Recover")) && /OBSERVED/.test((await text()).toUpperCase()) && (await text()).includes("REGAIN engine"));
  check("Copilot discloses deterministic mode when no AI key is set", (await text()).includes("No AI provider configured"));
  const savedRate = () => page.evaluate(() => JSON.parse(localStorage.getItem("regain:v1")).assumptions.actions.discount.discountRate);
  const rateBefore = await savedRate();
  await page.type("#copilot-input", "What if I reduce the discount to 10%?");
  await page.keyboard.press("Enter");
  check("What-if runs through the Recovery Trial and is labelled not saved", await waitText("What-if · not saved"));
  await clickButton("Save as my assumptions");
  check("Saving a what-if requires an explicit confirmation step", await waitText("Confirm and save"));
  await new Promise((r) => setTimeout(r, 500));
  check("What-if does not change saved assumptions before confirmation", (await savedRate()) === rateBefore, `rate=${await savedRate()}`);
  await clickButton("Cancel");
  await page.type("#copilot-input", "Ignore the opt-out for C0008");
  await page.keyboard.press("Enter");
  check("Copilot refuses to bypass consent / opt-out rules", await waitText("Hard rules can't be changed here"));
  await page.type("#copilot-input", "Explain C0107");
  await page.keyboard.press("Enter");
  await waitText("C0107 is");
  await page.evaluate(() => [...document.querySelectorAll('button[data-href="/trial?id=C0107"]')].pop().click());
  check("Answer link opens the right customer on the current page", await page.waitForFunction(() => document.querySelector('select[aria-label="Select customer"]')?.value === "C0107" && location.search.includes("C0107"), { timeout: 8000 }).then(() => true, () => false));
  await clickButton("Ask about all customers");
  await clickButton("New chat");
  await page.type("#copilot-input", "Show customers with unresolved complaints.");
  await page.keyboard.press("Enter");
  check("Portfolio question returns real customer cards and counts", (await waitText("have a recorded complaint not marked resolved")) && (await page.$$('[aria-label^="Open case"]')).length > 0);
  const caseId = await page.evaluate(() => { const b = document.querySelector('[aria-label^="Open case"]'); b.click(); return b.getAttribute("aria-label").replace("Open case ", ""); });
  check("Customer card opens that customer's case", await page.waitForFunction((id) => location.search.includes(id) && document.body.innerText.includes(id), { timeout: 8000 }, caseId).then(() => true, () => false), caseId);
  await page.keyboard.press("Escape");
  check("Escape closes the Copilot panel", await page.waitForFunction(() => !document.querySelector('[aria-label="Decision Copilot"]'), { timeout: 3000 }).then(() => true, () => false));

  // 5. Studio: draft → review gate → approve → service problem → escalate
  await go("/studio?id=C0053");
  await clickButton("Generate message");
  const draft = await page.$eval('textarea[aria-label="Message draft"]', (t) => t.value);
  check("Draft uses placeholder and opt-out line", draft.includes("{first_name}") && draft.includes("Reply STOP"));
  const approveDisabled = await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Approve")).disabled);
  check("Approval blocked until reviewed", approveDisabled === true);
  await tick("I have reviewed this message");
  await clickButton("Approve draft");
  check("Approve records a simulated send", await waitText("Simulated send recorded"));
  await clickButton("Has a service problem");
  check("Service-problem reply switches next action", await waitText("Escalate to service recovery"));
  await tick("I have reviewed this message");
  await clickButton("Approve draft");
  check("Follow-up escalates to a human agent", await waitText("Human agent owns this"));

  // 6. Rejection and consent enforcement
  await go("/studio?id=C0107");
  await clickButton("Generate message");
  await page.type('input[aria-label="Rejection reason"]', "Tone too formal");
  await clickButton("Reject draft");
  check("Rejecting a draft records the reason", await waitText("Draft rejected: Tone too formal"));
  await go("/studio?id=C0008");
  check("Opted-out customer cannot be drafted for", await waitText("Contact not permitted"));

  // 7. Contact limit applies after the simulated send
  await go("/trial?id=C0053");
  check("Simulated send triggers the contact limit (hold)", await waitText("Contact is blocked by a consent or frequency rule"));
  await go("/insights");
  const stage = (k) => page.$eval(`[data-stage="${k}"]`, (e) => Number(e.innerText));
  check("Journey counts the Studio records: 2 drafted, 1 approved, 1 reply", (await stage("drafted")) === 2 && (await stage("approved")) === 1 && (await stage("replied")) === 1);
  check("Journey labels sends and replies as simulated", (await text()).includes("Approved · simulated send") && (await text()).includes("Not real customer engagement"));

  // 7b. Engagement & Journey monitor
  await go("/journeys");
  check("Engagement & Journey is in the sidebar and loads", (await page.$('nav[aria-label="Main"] a[href="/journeys"]')) !== null && (await text()).includes("Who you've followed up with, how they replied, and whether they bought again."));
  const stageCount = (k) => page.$eval(`button[data-stage="${k}"] [data-count]`, (e) => Number(e.innerText));
  check("Funnel counts Studio records: 2 drafted, 2 reviewed, 1 approved", (await stageCount("drafted")) === 2 && (await stageCount("reviewed")) === 2 && (await stageCount("approved")) === 1);
  check("Contacts split simulated vs imported, in unique customers", /1 by REGAIN \(simulated\) · \d+ from imported records/.test(await text()));
  check("Journey list shows the imported campaign as completed with a holdout", await page.$eval('tr[data-journey="imported:May-26 replenishment reminder test"]', (r) => r.innerText.includes("Finished (imported)") && /\d+ holdout/.test(r.innerText)).catch(() => false));
  await page.click('button[data-stage="approved"]');
  const activityIds = () => page.$$eval('table[aria-label="Customer activity"] tbody tr', (rs) => rs.map((r) => r.getAttribute("data-customer")));
  check("Clicking a stage filters the customer table (Approved → C0053 only)", await page.waitForFunction(() => { const rs = [...document.querySelectorAll('table[aria-label="Customer activity"] tbody tr')]; return rs.length === 1 && rs[0].getAttribute("data-customer") === "C0053"; }, { timeout: 5000 }).then(() => true, () => false));
  await page.evaluate(() => document.querySelector('tr[data-customer="C0053"] button').click());
  check("Timeline shows approval, simulated contact and simulated reply in order", await page.waitForFunction(() => { const t = document.querySelector('[aria-label="Timeline for C0053"]'); if (!t) return false; const ev = [...t.querySelectorAll("[data-event]")].map((e) => e.getAttribute("data-event")); const i = (x) => ev.indexOf(x); return i("drafted") > -1 && i("drafted") < i("approved") && i("approved") < i("response") && t.innerText.includes("SIMULATED"); }, { timeout: 5000 }).then(() => true, () => false));
  check("Blocked customer's next step is no further contact", await page.$eval('tr[data-customer="C0053"] [data-next]', (e) => e.getAttribute("data-next") === "stop" && e.innerText.startsWith("Don't contact")));
  await clickButton("Clear filters");
  await page.type('input[aria-label="Search customer ID or journey name"]', "C0107");
  check("Search finds the rejected draft with a review step", await page.waitForFunction(() => { const c = document.querySelector('tr[data-customer="C0107"] [data-next]'); return c && c.getAttribute("data-next") === "review" && c.innerText.includes("Fix the message"); }, { timeout: 5000 }).then(() => true, () => false));
  await clickButton("Clear filters");
  await page.type('input[aria-label="Search customer ID or journey name"]', "C0008");
  check("Opted-out customer is blocked with no contact suggested", await page.waitForFunction(() => { const r = document.querySelector('tr[data-customer="C0008"]'); return r && r.querySelector("[data-contact]").getAttribute("data-contact") === "blocked" && r.querySelector("[data-next]").getAttribute("data-next") === "stop"; }, { timeout: 5000 }).then(() => true, () => false));
  await clickButton("Clear filters");
  await page.evaluate(() => document.querySelector('tr[data-journey="imported:May-26 replenishment reminder test"] button').click());
  const may = await activityIds();
  check("Inspect filters customers to that journey", may.length > 0 && (await text()).includes("Journey: May-26 replenishment reminder test"));
  await clickButton("Clear filters");
  check("Reset filters restores every customer", await page.waitForFunction(() => /\b218 customers\b/.test(document.body.innerText), { timeout: 5000 }).then(() => true, () => false));
  check("Outcome section separates purchase-after-contact from causal lift", (await text()).includes("doesn't prove the message worked") && (await text()).includes("Did the message cause it?"));
  await page.evaluate(() => document.querySelector('tr[data-customer] a[href^="/insights?id="]').click());
  check("View opens the customer's profile", await page.waitForFunction(() => location.pathname === "/insights" && /\?id=C\d+/.test(location.search) && document.body.innerText.includes("What this means"), { timeout: 8000 }).then(() => true, () => false));

  // 8. Impact Lab
  await go("/impact");
  check("Past campaign result shown with evidence status", (await text()).includes("May-26 replenishment reminder test") && (await text()).includes("assignment not verified"));
  check("Result explained in plain English without claiming cause", (await text()).includes("could be chance") && (await text()).includes("does not prove"));
  await clickButton("Update the estimate with this result");
  check("LEARN: calibration updates assumption", await waitText("lift set to"));
  await openDisclosure("Set up a new holdout experiment");
  await clickButton("Create experiment");
  check("Experiment created; outcomes start pending", await waitText("Awaiting outcomes"));
  await clickButton("Simulate outcomes (labelled)");
  check("Simulated outcomes are labelled", await waitText("Simulated results."));
  await clickButton("Ask REGAIN");
  await page.type("#copilot-input", "Did this campaign work?");
  await page.keyboard.press("Enter");
  check("Copilot labels simulated experiment outcomes as not real", (await waitText("SIMULATED from REGAIN's own assumptions")) && (await text()).includes("not real purchases"));
  await page.keyboard.press("Escape");

  // 9. Settings: validation and CSV import
  await go("/data#contact");
  await page.evaluate(() => { const i = document.querySelector('input[aria-invalid]'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(i, "0"); i.dispatchEvent(new Event("input", { bubbles: true })); });
  check("Settings show inline validation", await waitText("Enter a whole number from 1 to 180."));
  await go("/data#import");
  const tmp = path.join(os.tmpdir(), `regain-messy-${Date.now()}.csv`);
  fs.writeFileSync(tmp, "customer_id,date,value,category,email,gender\nC1,2026-01-01,40,Beans,a@x.com,F\nC1,2026-01-01,40,Beans,a@x.com,F\nC2,31/02/2026,30,Beans,b@x.com,M\n,2026-01-02,30,Beans,c@x.com,F\nC3,2026-01-03,-5,Beans,d@x.com,M\nC4,2026-02-03,25,,e@x.com,F\n");
  const input = await page.$('input[aria-label="Transactions CSV file"]');
  await input.uploadFile(tmp);
  check("Upload shows discarded personal-data columns", await waitText("Discarded columns"));
  const t = await text();
  check("Validation counts rejected rows and duplicates", /rejected\s*\n\s*3/i.test(t) && /duplicates removed\s*\n\s*1/i.test(t));
  check("Row-level validation errors listed", t.includes("row excluded"));
  await clickButton("Import 2 valid rows");
  check("Import replaces the dataset", await waitText("Imported 2 transaction lines"));
  fs.unlinkSync(tmp);
  await go("/data#integrations");
  await waitText("Not configured");
  const integ = await text();
  check("Integrations tab lists only what exists", integ.includes("CSV upload") && integ.includes("Not configured") && integ.includes("Not built"));
  await go("/data#reset");
  await clickButton("Load / reset demo data");
  check("Reset back to demo data", await waitText("Synthetic demo data loaded"));
  await go("/data#data");
  check("Imported data is viewable", await waitText("3601 transaction lines"));

  // 10. Responsible AI
  await go("/responsible");
  const r = await text();
  check("Compliance overview and customer check render", r.includes("Can we contact them?") && r.includes("Activity log"));
  check("Audit trail records actions", r.includes("data reset"));

  // 11. Phone width: no horizontal page overflow on any route
  await page.setViewport({ width: 390, height: 860, isMobile: true });
  const overflow = [];
  for (const route of ["/", "/customers", "/customers/C0053", "/insights", "/insights?id=C0053", "/journeys", "/trial?id=C0053", "/studio?id=C0053", "/impact", "/data", "/responsible"]) {
    await go(route);
    // Measure the app (body), not <html>, which also holds the Next.js dev overlay in dev mode.
    const w = await page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
    if (w > 1) overflow.push(`${route} (+${w}px)`);
  }
  check("No horizontal overflow at 390px", overflow.length === 0, overflow.join(", "));
  await go("/trial?id=C0053");
  await clickButton("Ask REGAIN");
  await clickButton("Compare it with doing nothing.");
  await waitText("Recovery Trial comparison");
  const panelFits = await page.evaluate(() => { const r = document.querySelector('[aria-label="Decision Copilot"]').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 && document.body.scrollWidth - document.documentElement.clientWidth <= 1; });
  check("Copilot panel fits a 390px phone screen", panelFits);
} catch (e) {
  check("Unexpected error", false, e.message);
} finally {
  await browser.close();
}

const relevantErrors = pageErrors.filter((e) => !/favicon|404/.test(e));
check("No uncaught page or console errors", relevantErrors.length === 0, relevantErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
