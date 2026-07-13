import { NextResponse } from "next/server";
import { listLlmModels, resolveLlmConfig } from "@/lib/server/llmQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  baseUrl?: string;
  apiKey?: string;
};

/** List models from the configured (or override) OpenAI-compatible endpoint. */
export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  try {
    const models = await listLlmModels({
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    const config = resolveLlmConfig({
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    return NextResponse.json({
      models,
      baseUrl: config.baseUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list models";
    return NextResponse.json({ error: msg, models: [] }, { status: 502 });
  }
}

export async function GET() {
  try {
    const models = await listLlmModels();
    const config = resolveLlmConfig();
    return NextResponse.json({ models, baseUrl: config.baseUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list models";
    return NextResponse.json({ error: msg, models: [] }, { status: 502 });
  }
}
