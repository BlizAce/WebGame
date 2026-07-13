import { NextResponse } from "next/server";
import {
  enqueueChatCompletion,
  llmQueueStats,
  resolveLlmConfig,
} from "@/lib/server/llmQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  purpose?: "forum" | "mind" | "mail" | "general";
  /** Override OpenAI-compatible base URL for this call. */
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  for (const m of messages) {
    if (!m?.role || typeof m.content !== "string") {
      return NextResponse.json({ error: "bad message" }, { status: 400 });
    }
  }

  try {
    const text = await enqueueChatCompletion({
      messages,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      purpose: body.purpose,
      baseUrl: body.baseUrl,
      model: body.model,
      apiKey: body.apiKey,
    });
    return NextResponse.json({
      text,
      queue: llmQueueStats(),
      config: resolveLlmConfig({
        baseUrl: body.baseUrl,
        model: body.model,
        apiKey: body.apiKey,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM failed";
    console.error("[forum/llm]", msg);
    return NextResponse.json(
      { error: msg, queue: llmQueueStats() },
      { status: 502 },
    );
  }
}

export async function GET() {
  const config = resolveLlmConfig();
  return NextResponse.json({
    ok: true,
    queue: llmQueueStats(),
    config: {
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: Boolean(config.apiKey),
    },
  });
}
