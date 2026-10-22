// OPTIONAL external AI drafting. Runs only on the server and only if ANTHROPIC_API_KEY is set.
// Without a key (the default) the deterministic template is returned. The customer ID and raw
// history are never sent — only the minimal, non-identifying facts already shown to the reviewer.
import { NextResponse } from "next/server";
import { checkClaims, draftMessage, OPT_OUT_LINE, type MessageContext } from "@/lib/conversation";
import { sanitizeText } from "@/lib/utils";

export const runtime = "nodejs";

const ACTIONS = new Set(["check_in", "reminder", "service_recovery", "benefit", "discount"]);

function parseContext(body: unknown): MessageContext | null {
  if (!body || typeof body !== "object") return null;
  const c = (body as { context?: Record<string, unknown> }).context;
  if (!c || !ACTIONS.has(String(c.action))) return null;
  const tone = ["warm", "professional", "concise"].includes(String(c.tone)) ? (c.tone as MessageContext["tone"]) : "warm";
  const channel = ["email", "sms", "whatsapp"].includes(String(c.channel)) ? (c.channel as MessageContext["channel"]) : "email";
  const issue = c.issue && typeof c.issue === "object" ? { date: sanitizeText((c.issue as Record<string, unknown>).date, 20), issue: sanitizeText((c.issue as Record<string, unknown>).issue, 80) } : undefined;
  return {
    businessName: sanitizeText(c.businessName, 60) || "our team",
    tone,
    channel,
    action: c.action as MessageContext["action"],
    decision: c.decision === "UNDERSTAND" ? "UNDERSTAND" : "RECOVER",
    topCategory: sanitizeText(c.topCategory, 40) || "order",
    lastOrderDate: /^\d{4}-\d{2}-\d{2}$/.test(String(c.lastOrderDate)) ? String(c.lastOrderDate) : "2026-01-01",
    recencyDays: Math.max(0, Math.min(5000, Number(c.recencyDays) || 0)),
    usualInterval: c.usualInterval ? Math.max(1, Math.min(1000, Number(c.usualInterval))) : null,
    issue,
    discountRate: Math.max(0, Math.min(0.5, Number(c.discountRate) || 0)),
    benefitDescription: sanitizeText(c.benefitDescription, 80) || "a small thank-you benefit",
  };
}

export async function GET() {
  return NextResponse.json({ aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY), provider: process.env.ANTHROPIC_API_KEY ? "Anthropic Messages API" : null });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ctx = parseContext(body);
  if (!ctx) return NextResponse.json({ error: "Invalid message context" }, { status: 400 });
  const template = draftMessage(ctx);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ source: "template", text: template, note: "No AI provider configured — deterministic template used." });

  const facts = [
    `Business: ${ctx.businessName}`,
    `Recommended action: ${ctx.action}`,
    `Tone: ${ctx.tone}; channel: ${ctx.channel}`,
    `Most frequent category: ${ctx.topCategory}`,
    `Last order month: ${ctx.lastOrderDate.slice(0, 7)}`,
    ctx.usualInterval ? `Usual gap between orders: about ${ctx.usualInterval} days` : "No regular purchase rhythm",
    ctx.issue ? `Recorded service issue on ${ctx.issue.date}: ${ctx.issue.issue}` : "No service issue recorded",
    ctx.action === "discount" ? `Approved discount: ${Math.round(ctx.discountRate * 100)}% off next order, valid 14 days` : "No discount is approved",
    ctx.action === "benefit" ? `Approved benefit: ${ctx.benefitDescription}` : "",
  ].filter(Boolean);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 400,
        system:
          "You draft short, respectful customer-retention messages for a small business. Use ONLY the facts provided. Never invent purchase history, products, prices, offers, or problems. Do not mention discounts unless an approved discount is listed. Do not apologise for anything unless a service issue is recorded. No pressure tactics or urgency. Start with a greeting containing the literal placeholder {first_name}. End with the exact line: " +
          OPT_OUT_LINE +
          " Output only the message text.",
        messages: [{ role: "user", content: `Facts:\n- ${facts.join("\n- ")}\n\nWrite the message.` }],
      }),
    });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = sanitizeMultiline(data.content?.find((c) => c.type === "text")?.text ?? "");
    const blocking = checkClaims(text, ctx).filter((w) => w.severity === "block");
    if (!text || blocking.length) {
      return NextResponse.json({ source: "template", text: template, note: `AI draft failed the claims check (${blocking.map((b) => b.message).join("; ") || "empty"}) — template used instead.` });
    }
    return NextResponse.json({ source: "ai", text, note: "Drafted by an external AI model (Anthropic). Review required before approval." });
  } catch (e) {
    return NextResponse.json({ source: "template", text: template, note: `AI provider unavailable (${e instanceof Error ? e.message : "error"}) — template used.` });
  }
}

function sanitizeMultiline(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 1500);
}
