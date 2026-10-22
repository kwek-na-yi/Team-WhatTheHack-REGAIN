// Adaptive Conversation Studio logic: deterministic message drafting from recorded facts only,
// a claims guard that flags unsupported statements, and a pure conversation state machine.
// Nothing here sends a real message.
import type { ActionId, CustomerProfile, Decision } from "./types";

export type Tone = "warm" | "professional" | "concise";
export type Channel = "email" | "sms" | "whatsapp";
export type ResponseKind = "interested" | "not_interested" | "service_problem" | "needs_info";

export interface MessageContext {
  businessName: string;
  tone: Tone;
  channel: Channel;
  action: ActionId;
  decision: Decision;
  topCategory: string;
  lastOrderDate: string;
  recencyDays: number;
  usualInterval: number | null;
  issue?: { date: string; issue: string };
  discountRate: number;
  benefitDescription: string;
}

export function contextFromProfile(
  p: CustomerProfile,
  o: { businessName: string; tone: Tone; channel: Channel; action: ActionId; decision: Decision; discountRate: number; benefitDescription: string },
): MessageContext {
  return {
    ...o,
    topCategory: p.topCategory === "Uncategorised" ? "order" : p.topCategory,
    lastOrderDate: p.lastOrderDate,
    recencyDays: p.recencyDays,
    usualInterval: p.rhythmSource === "personal" ? Math.round(p.medianInterval as number) : null,
    issue: p.openServiceIssue ? { date: p.openServiceIssue.date, issue: p.openServiceIssue.issue } : undefined,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthName(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

export const OPT_OUT_LINE = "Reply STOP to stop these messages.";

function greet(t: Tone): string {
  return t === "professional" ? "Dear {first_name}," : t === "concise" ? "Hi {first_name}," : "Hi {first_name}!";
}
function signoff(c: MessageContext): string {
  return c.tone === "professional" ? `Kind regards,\nThe ${c.businessName} team` : `— ${c.businessName}`;
}

/** Deterministic draft. Uses only facts present in the context; {first_name} is merged at send time
 * by the business's own system so that REGAIN never needs to store names. */
export function draftMessage(c: MessageContext): string {
  const cat = c.topCategory.toLowerCase();
  const when = monthName(c.lastOrderDate);
  let body: string;
  switch (c.action) {
    case "check_in":
      body =
        c.tone === "concise"
          ? `It's been a while since your last order in ${when}. Is there anything we could do better, or anything you're looking for? Just reply — no pressure.`
          : c.tone === "professional"
            ? `We noticed it has been some time since your last order with us in ${when}. We would value your feedback: is there anything we could improve, or anything you are looking for? You are welcome to simply reply to this message.`
            : `It's been a little while since your last order with us in ${when}, so we wanted to check in. How are things going? If there's anything we could do better — or anything you're looking for — just reply. No pressure at all.`;
      break;
    case "reminder":
      body =
        c.usualInterval
          ? `You usually pick up ${cat} from us about every ${c.usualInterval} days, and your last order was in ${when}. If you're running low, your usual is ready whenever you are.`
          : `Your last ${cat} order with us was in ${when}. If you're running low, we're here whenever you need a top-up.`;
      if (c.tone === "professional") body = body.replace("If you're running low", "Should you be running low").replace("we're here", "we are here");
      break;
    case "service_recovery":
      body = c.issue
        ? `We noticed your order on ${c.issue.date} had a problem ("${c.issue.issue}"), and we're sorry about that. We'd like to put it right. Could you reply and tell us what would help most? A member of our team will follow up personally.`
        : `We'd like to hear how your recent experience with us went. Could you reply and let us know?`;
      break;
    case "benefit":
      body = `Thank you for being a ${c.businessName} customer. We'd like to offer you ${c.benefitDescription} on your next ${cat} order — no code needed, just mention this message.`;
      break;
    case "discount":
      body = `As a thank-you for shopping with us, here is ${Math.round(c.discountRate * 100)}% off your next ${cat} order, valid for 14 days.`;
      break;
    default:
      return "";
  }
  return `${greet(c.tone)}\n\n${body}\n\n${signoff(c)}\n${OPT_OUT_LINE}`;
}

export function followUpDraft(kind: ResponseKind, c: MessageContext): string {
  const g = greet(c.tone);
  const s = `${signoff(c)}\n${OPT_OUT_LINE}`;
  switch (kind) {
    case "interested":
      return `${g}\n\nGreat to hear from you! You can reorder your usual ${c.topCategory.toLowerCase()} on our website or reply here and we'll set it aside for you.\n\n${s}`;
    case "not_interested":
      return `${g}\n\nThanks for letting us know — we won't contact you about this again. You can reply STOP at any time to opt out of all messages.\n\n${signoff(c)}`;
    case "service_problem":
      return `${g}\n\nWe're sorry to hear that, and thank you for telling us. A member of our team will contact you personally to put it right.\n\n${s}`;
    case "needs_info":
      return `${g}\n\nHappy to help. [Add the factual answer to the customer's question here — REGAIN does not invent product details.]\n\n${s}`;
  }
}

export const SIMULATED_REPLY: Record<ResponseKind, string> = {
  interested: "Oh yes, I've been meaning to reorder. Thanks for the reminder!",
  not_interested: "No thanks, I'm not interested at the moment.",
  service_problem: "Honestly my last order arrived late and nobody got back to me.",
  needs_info: "Do you have anything less acidic? What would you recommend?",
};

export interface ClaimWarning {
  severity: "block" | "warn";
  message: string;
}

/** Flags statements the evidence does not support. "block" warnings prevent approval. */
export function checkClaims(text: string, c: Pick<MessageContext, "action" | "issue" | "channel">): ClaimWarning[] {
  const w: ClaimWarning[] = [];
  const t = text.toLowerCase();
  if (!t.trim()) return [{ severity: "block", message: "Message is empty." }];
  if (c.action !== "discount" && /(\d+\s?%|percent|discount|voucher|coupon|promo code|\$\d+\s?off)/.test(t))
    w.push({ severity: "block", message: "Mentions a discount or incentive that the Recovery Trial did not recommend." });
  if (!c.issue && /(sorry|apolog|problem with your|issue with your|complaint)/.test(t))
    w.push({ severity: "block", message: "Refers to a problem or apology, but no service issue is recorded for this customer." });
  if (/(last chance|expires today|only today|act now|hurry|final notice|don't miss out)/.test(t))
    w.push({ severity: "warn", message: "High-pressure language detected. REGAIN recommends low-pressure wording." });
  if (!/stop/.test(t)) w.push({ severity: "block", message: "Missing opt-out instruction (e.g. 'Reply STOP')." });
  if (/https?:\/\/|www\./.test(t)) w.push({ severity: "warn", message: "Contains a link. Links are not verified by REGAIN." });
  if (/(we miss you so much|you must|you need to buy)/.test(t)) w.push({ severity: "warn", message: "Wording may feel presumptive or manipulative." });
  if (/\[add the factual answer/.test(t)) w.push({ severity: "block", message: "Placeholder still present — add the factual answer before approval." });
  if (c.channel !== "email" && text.length > 640) w.push({ severity: "warn", message: `${text.length} characters is long for ${c.channel.toUpperCase()}.` });
  return w;
}

// ------------------------------ state machine ------------------------------

export type ConvStatus =
  | "draft"
  | "rejected"
  | "awaiting_response"
  | "positive"
  | "declined"
  | "service_issue"
  | "info_requested"
  | "closed"
  | "escalated";

export interface ConvMessage {
  from: "business" | "customer" | "system";
  text: string;
  simulated: boolean;
}

export interface NextStep {
  title: string;
  detail: string;
}

export interface ConversationState {
  customerId: string;
  status: ConvStatus;
  action: ActionId;
  draft: string;
  draftSource: "template" | "ai" | "edited";
  messages: ConvMessage[];
  next: NextStep;
  error?: string;
  lastResponse?: ResponseKind;
  rejectionReason?: string;
  /** Number of messages approved (each counts as a contact for frequency caps). */
  sends: number;
}

export type ConvEvent =
  | { type: "SET_DRAFT"; text: string; source: "template" | "ai" | "edited" }
  | { type: "APPROVE"; reviewed: boolean; warnings: ClaimWarning[] }
  | { type: "REJECT"; reason: string }
  | { type: "RESPOND"; kind: ResponseKind; ctx: MessageContext }
  | { type: "RESET"; draft: string; action: ActionId };

const NEXT: Record<ConvStatus, NextStep> = {
  draft: { title: "Review the draft", detail: "Check every statement against the evidence, edit if needed, then approve or reject." },
  rejected: { title: "Revise or hold", detail: "Edit or regenerate the draft, or leave this customer on HOLD." },
  awaiting_response: { title: "Wait for a reply", detail: "Simulated send recorded. Choose a simulated customer response to continue." },
  positive: { title: "Make it easy to return — no discount needed", detail: "Send a helpful follow-up, then measure whether a purchase happens inside the experiment window." },
  declined: { title: "Respect the answer", detail: "Send a short acknowledgement, stop the sequence and suppress further marketing for 90 days. Do not escalate to an incentive." },
  service_issue: { title: "Escalate to service recovery", detail: "Switch action to Service recovery, pause all promotions and route to a human agent with the customer's context." },
  info_requested: { title: "Answer factually", detail: "Reply with accurate product information written by staff. Keep the conversation open." },
  closed: { title: "Measure the outcome", detail: "Conversation closed. Purchase (or not) will be measured in the Impact Lab — not assumed." },
  escalated: { title: "Human agent owns this", detail: "Service case handed over. Marketing paused until resolved." },
};

export function initConversation(customerId: string, action: ActionId, draft: string): ConversationState {
  return { customerId, status: "draft", action, draft, draftSource: "template", messages: [], next: NEXT.draft, sends: 0 };
}

/** After approving a follow-up, where does the conversation go? */
const AFTER_FOLLOW_UP: Partial<Record<ConvStatus, ConvStatus>> = {
  positive: "closed",
  declined: "closed",
  service_issue: "escalated",
  info_requested: "awaiting_response",
};

export function conversationReducer(s: ConversationState, e: ConvEvent): ConversationState {
  switch (e.type) {
    case "RESET":
      return initConversation(s.customerId, e.action, e.draft);
    case "SET_DRAFT":
      if (s.status === "closed" || s.status === "escalated" || s.status === "awaiting_response") return { ...s, error: "No draft can be edited in the current state." };
      return { ...s, draft: e.text, draftSource: e.source, status: s.status === "rejected" ? "draft" : s.status, next: s.status === "rejected" ? NEXT.draft : s.next, error: undefined };
    case "APPROVE": {
      const canApprove = ["draft", "positive", "declined", "service_issue", "info_requested"].includes(s.status);
      if (!canApprove) return { ...s, error: "Nothing to approve in the current state." };
      if (!e.reviewed) return { ...s, error: "Confirm that you have reviewed the message before approving." };
      if (e.warnings.some((w) => w.severity === "block")) return { ...s, error: "Resolve the blocking issues flagged by the claims check first." };
      if (!s.draft.trim()) return { ...s, error: "The draft is empty." };
      const status: ConvStatus = s.status === "draft" ? "awaiting_response" : (AFTER_FOLLOW_UP[s.status] as ConvStatus);
      return {
        ...s,
        status,
        messages: [...s.messages, { from: "business", text: s.draft, simulated: true }, { from: "system", text: "Simulated send recorded — no real message was sent.", simulated: true }],
        draft: "",
        next: NEXT[status],
        error: undefined,
        sends: s.sends + 1,
      };
    }
    case "REJECT":
      if (!["draft", "positive", "declined", "service_issue", "info_requested"].includes(s.status)) return { ...s, error: "Nothing to reject in the current state." };
      return { ...s, status: "rejected", rejectionReason: e.reason || "No reason given", next: NEXT.rejected, error: undefined, messages: [...s.messages, { from: "system", text: `Draft rejected: ${e.reason || "no reason given"}.`, simulated: false }] };
    case "RESPOND": {
      if (s.status !== "awaiting_response") return { ...s, error: "A response can only be simulated after a message has been approved." };
      const status: ConvStatus = e.kind === "interested" ? "positive" : e.kind === "not_interested" ? "declined" : e.kind === "service_problem" ? "service_issue" : "info_requested";
      const action: ActionId = e.kind === "service_problem" ? "service_recovery" : e.kind === "not_interested" ? "no_action" : s.action;
      return {
        ...s,
        status,
        action,
        lastResponse: e.kind,
        messages: [...s.messages, { from: "customer", text: SIMULATED_REPLY[e.kind], simulated: true }],
        draft: followUpDraft(e.kind, { ...e.ctx, issue: e.ctx.issue ?? (e.kind === "service_problem" ? { date: "recent", issue: "reported in reply" } : undefined) }),
        draftSource: "template",
        next: NEXT[status],
        error: undefined,
      };
    }
  }
}

export const STATUS_LABEL: Record<ConvStatus, string> = {
  draft: "Draft — awaiting review",
  rejected: "Rejected",
  awaiting_response: "Sent (simulated) — awaiting reply",
  positive: "Customer interested",
  declined: "Customer not interested",
  service_issue: "Service problem reported",
  info_requested: "Needs more information",
  closed: "Closed — measure outcome",
  escalated: "Escalated to human agent",
};
