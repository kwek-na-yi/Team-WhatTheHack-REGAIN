import { describe, expect, it } from "vitest";
import { checkClaims, contextFromProfile, conversationReducer, draftMessage, initConversation, type MessageContext } from "@/lib/conversation";
import { profileOf, regular } from "./helpers";

const p = profileOf(regular("A", 25, 45, 10), "A");
const ctx: MessageContext = contextFromProfile(p, { businessName: "Kopi & Co.", tone: "warm", channel: "email", action: "reminder", decision: "RECOVER", discountRate: 0.15, benefitDescription: "a free upgrade" });

describe("message generation", () => {
  it("is deterministic and uses only recorded facts", () => {
    const a = draftMessage(ctx);
    expect(a).toBe(draftMessage(ctx));
    expect(a).toContain("{first_name}");
    expect(a).toContain("every 25 days");
    expect(a).toContain("Reply STOP");
    expect(a).not.toMatch(/%|discount|sorry/i);
    expect(checkClaims(a, ctx)).toEqual([]);
  });
  it("only mentions a discount when the discount action was recommended", () => {
    expect(draftMessage({ ...ctx, action: "discount" })).toContain("15% off");
    expect(checkClaims("Hi {first_name}, 20% off! Reply STOP", ctx).some((w) => w.severity === "block")).toBe(true);
  });
  it("blocks apologies when no service issue is recorded", () => {
    const w = checkClaims("Hi {first_name}, sorry about the problem with your order. Reply STOP", { ...ctx, issue: undefined });
    expect(w.some((x) => x.severity === "block" && x.message.includes("no service issue"))).toBe(true);
    expect(checkClaims("Hi, sorry about the delay. Reply STOP", { ...ctx, issue: { date: "2026-01-01", issue: "Late" } }).some((x) => x.severity === "block")).toBe(false);
  });
  it("requires an opt-out line and flags pressure language", () => {
    expect(checkClaims("Hi {first_name}", ctx).some((w) => w.message.includes("opt-out"))).toBe(true);
    expect(checkClaims("Last chance! Reply STOP", ctx).some((w) => w.message.includes("High-pressure"))).toBe(true);
  });
  it("does not mention a rhythm when none exists", () => {
    const m = draftMessage({ ...ctx, usualInterval: null });
    expect(m).not.toMatch(/every \d+ days/);
  });
});

describe("conversation state transitions", () => {
  const start = () => initConversation("A", "reminder", draftMessage(ctx));
  const ok = { type: "APPROVE" as const, reviewed: true, warnings: [] };

  it("requires review before approval", () => {
    const s = conversationReducer(start(), { type: "APPROVE", reviewed: false, warnings: [] });
    expect(s.status).toBe("draft");
    expect(s.error).toMatch(/reviewed/);
  });
  it("blocks approval when the claims check has blocking issues", () => {
    const s = conversationReducer(start(), { type: "APPROVE", reviewed: true, warnings: [{ severity: "block", message: "x" }] });
    expect(s.status).toBe("draft");
    expect(s.sends).toBe(0);
  });
  it("approve → awaiting response → interested → closed", () => {
    let s = conversationReducer(start(), ok);
    expect(s.status).toBe("awaiting_response");
    expect(s.sends).toBe(1);
    s = conversationReducer(s, { type: "RESPOND", kind: "interested", ctx });
    expect(s.status).toBe("positive");
    expect(s.next.title).toMatch(/no discount/i);
    expect(s.draft).not.toMatch(/%/);
    s = conversationReducer(s, ok);
    expect(s.status).toBe("closed");
  });
  it("not interested → declined, action becomes no action", () => {
    const s = conversationReducer(conversationReducer(start(), ok), { type: "RESPOND", kind: "not_interested", ctx });
    expect(s.status).toBe("declined");
    expect(s.action).toBe("no_action");
    expect(s.next.detail).toMatch(/suppress/i);
  });
  it("service problem → escalates to service recovery", () => {
    let s = conversationReducer(conversationReducer(start(), ok), { type: "RESPOND", kind: "service_problem", ctx });
    expect(s.status).toBe("service_issue");
    expect(s.action).toBe("service_recovery");
    s = conversationReducer(s, ok);
    expect(s.status).toBe("escalated");
  });
  it("needs info → placeholder must be replaced before approval, then back to awaiting", () => {
    let s = conversationReducer(conversationReducer(start(), ok), { type: "RESPOND", kind: "needs_info", ctx });
    expect(s.status).toBe("info_requested");
    expect(checkClaims(s.draft, ctx).some((w) => w.severity === "block")).toBe(true);
    s = conversationReducer(s, { type: "SET_DRAFT", text: "Hi {first_name}, our Colombian roast is lower in acidity. Reply STOP to stop.", source: "edited" });
    s = conversationReducer(s, ok);
    expect(s.status).toBe("awaiting_response");
  });
  it("reject then edit returns to draft; responses are refused before a send", () => {
    let s = conversationReducer(start(), { type: "REJECT", reason: "Too long" });
    expect(s.status).toBe("rejected");
    expect(s.rejectionReason).toBe("Too long");
    s = conversationReducer(s, { type: "SET_DRAFT", text: "new", source: "edited" });
    expect(s.status).toBe("draft");
    const r = conversationReducer(start(), { type: "RESPOND", kind: "interested", ctx });
    expect(r.status).toBe("draft");
    expect(r.error).toBeDefined();
  });
});
