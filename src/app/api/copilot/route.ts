// OPTIONAL rewording of a Decision Copilot answer. Runs only on the server and only if ANTHROPIC_API_KEY
// is set. The browser sends pre-verified, redacted facts (see copilotGuard.buildModelFacts) — never raw
// records, CSV content or customer IDs. Every reply is validated; anything unsupported is discarded and
// the client keeps the deterministic answer.
import { NextResponse } from "next/server";
import { parseModelFacts, validateModelText } from "@/lib/copilotGuard";

export const runtime = "nodejs";

const MAX_BODY = 12_000;

export async function GET() {
  return NextResponse.json({ aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY), provider: process.env.ANTHROPIC_API_KEY ? "Anthropic Messages API" : null });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const facts = parseModelFacts(body);
  if (!facts) return NextResponse.json({ error: "Invalid facts" }, { status: 400 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ source: "deterministic", note: "No AI provider configured — REGAIN's own wording is shown." });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 300,
        system:
          "You reword verified analysis results for a small-business owner in at most 4 short, plain-English sentences. Use ONLY the facts given. Do not add numbers, customers, causes, feelings or advice that are not in the facts. Keep labels such as 'estimated', 'simulated' and 'inconclusive' when the facts use them. Never say a result proves anything. Refer to customers only by the labels given. Output plain text only.",
        messages: [{ role: "user", content: `Topic: ${facts.title}\nFacts:\n- ${facts.facts.join("\n- ")}\n\nReword these facts as a short answer.` }],
      }),
    });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const v = validateModelText(data.content?.find((c) => c.type === "text")?.text, facts);
    if (!v.ok) return NextResponse.json({ source: "deterministic", note: `AI wording rejected (${v.reason}) — REGAIN's own wording is shown.` });
    return NextResponse.json({ source: "ai", text: v.text, note: "Reworded by an external AI model (Anthropic) from REGAIN's verified facts, then checked." });
  } catch (e) {
    return NextResponse.json({ source: "deterministic", note: `AI provider unavailable (${e instanceof Error ? e.message : "error"}) — REGAIN's own wording is shown.` });
  }
}
