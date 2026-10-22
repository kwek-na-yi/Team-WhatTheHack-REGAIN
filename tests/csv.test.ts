import { describe, expect, it } from "vitest";
import { autoMap, classifyExcludedColumns, parseCsvText, parseDate, parseMoney, parseYesNo, TX_FIELDS, validateInterventions, validateTransactions, IV_FIELDS } from "@/lib/csv";
import { generateMessySample, generateSample, IV_HEADERS, rowsToCsv, TX_HEADERS } from "@/lib/sampleData";

const csv = (s: string) => parseCsvText(s.trim());

describe("CSV parsing helpers", () => {
  it("parses ISO, day-first and month-first dates and rejects impossible dates", () => {
    expect(parseDate("2026-03-05").date).toBe("2026-03-05");
    expect(parseDate("05/03/2026").date).toBe("2026-03-05");
    expect(parseDate("05/03/2026", "mdy").date).toBe("2026-05-03");
    expect(parseDate("05/03/2026").ambiguous).toBe(true);
    expect(parseDate("25/03/2026").ambiguous).toBe(false);
    expect(parseDate("31/02/2026").date).toBeNull();
    expect(parseDate("not a date").date).toBeNull();
    expect(parseDate("").date).toBeNull();
  });
  it("parses money and yes/no values", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("SGD 40")).toBe(40);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("-12.5")).toBe(-12.5);
    expect(parseYesNo("Y")).toBe("yes");
    expect(parseYesNo("false")).toBe("no");
    expect(parseYesNo("")).toBe("unknown");
    expect(parseYesNo("maybe")).toBe("unknown");
  });
  it("auto-maps common header synonyms", () => {
    const m = autoMap(["Customer ID", "Order Date", "Amount", "Product Category"], TX_FIELDS);
    expect(m).toMatchObject({ customer_id: "Customer ID", date: "Order Date", value: "Amount", category: "Product Category" });
  });
  it("discards sensitive attributes and direct identifiers but not innocent look-alikes", () => {
    const ex = classifyExcludedColumns(["customer_id", "email", "Gender", "date_of_birth", "phone", "usage_count", "percentage", "age"]).map((e) => e.column);
    expect(ex).toEqual(expect.arrayContaining(["email", "Gender", "date_of_birth", "phone", "age"]));
    expect(ex).not.toContain("usage_count");
    expect(ex).not.toContain("percentage");
    expect(ex).not.toContain("customer_id");
  });
});

describe("transaction validation", () => {
  const text = `customer_id,date,value,category,order_id
C1,2026-01-01,40,Beans,O1
C1,2026-01-01,40,Beans,O1
C2,2026-13-01,30,Beans,O2
,2026-01-02,30,Beans,O3
C3,2026-01-03,-5,Beans,O4
C4,2026-01-04,abc,Beans,O5
C5,2026-01-05,25,,O6
C6,2026-01-06,25,Tea,O1`;

  it("accepts valid rows, rejects invalid ones, removes duplicates and fills missing categories", () => {
    const p = csv(text);
    const r = validateTransactions(p, autoMap(p.headers, TX_FIELDS));
    expect(r.totalRows).toBe(8);
    expect(r.acceptedRows).toBe(2); // C1 (once) and C5
    expect(r.duplicateRows).toBe(1);
    expect(r.rejectedRows).toBe(5); // bad date, missing id, negative, non-numeric, order owned by other customer
    expect(r.records.find((t) => t.customerId === "C5")?.category).toBe("Uncategorised");
    expect(r.missingFilled.category).toBe(1);
    expect(r.issues.some((i) => i.message.includes("another customer"))).toBe(true);
  });

  it("reports unmapped required fields instead of guessing", () => {
    const p = csv("cust,when\nC1,2026-01-01");
    const r = validateTransactions(p, autoMap(p.headers, TX_FIELDS));
    expect(r.unmappedRequired).toEqual(expect.arrayContaining(["Transaction date", "Transaction value"]));
    expect(r.acceptedRows).toBe(0);
  });

  it("does not require optional columns and records which are missing", () => {
    const p = csv("customer_id,date,value\nC1,2026-01-01,10\nC1,2026-02-01,12");
    const r = validateTransactions(p, autoMap(p.headers, TX_FIELDS));
    expect(r.acceptedRows).toBe(2);
    expect(r.optionalMissing).toContain("Marketing consent");
    expect(r.records[0].marketingConsent).toBeUndefined();
    expect(r.records[0].orderId).toBe("C1@2026-01-01");
  });

  it("strips control characters from untrusted text", () => {
    const p = csv('customer_id,date,value,category\nC1,2026-01-01,10,"Be\u0007ans\u0000"');
    const r = validateTransactions(p, autoMap(p.headers, TX_FIELDS));
    expect(r.records[0].category).toBe("Be ans");
  });

  it("handles the messy sample: rejects bad rows and discards PII columns", () => {
    const p = parseCsvText(generateMessySample());
    const m = autoMap(p.headers, TX_FIELDS);
    expect(Object.values(m)).not.toContain("email");
    const r = validateTransactions(p, m);
    expect(r.excludedColumns.map((c) => c.column)).toEqual(expect.arrayContaining(["email", "gender"]));
    expect(r.rejectedRows).toBeGreaterThanOrEqual(4);
    expect(r.duplicateRows).toBeGreaterThanOrEqual(2);
    expect(r.ambiguousDates).toBeGreaterThanOrEqual(0);
  });

  it("imports the full synthetic sample without errors", () => {
    const { transactions, interventions } = generateSample();
    const p = parseCsvText(rowsToCsv(TX_HEADERS, transactions));
    const r = validateTransactions(p, autoMap(p.headers, TX_FIELDS));
    expect(r.rejectedRows).toBe(0);
    expect(r.acceptedRows).toBe(transactions.length);
    const ip = parseCsvText(rowsToCsv(IV_HEADERS, interventions));
    const ir = validateInterventions(ip, autoMap(ip.headers, IV_FIELDS));
    expect(ir.acceptedRows).toBe(interventions.length);
    expect(ir.records.some((x) => x.group === "control")).toBe(true);
  });

  it("generates identical sample data on every run (deterministic)", () => {
    expect(JSON.stringify(generateSample())).toBe(JSON.stringify(generateSample()));
  });
});
