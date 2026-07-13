/**
 * Server-side OpenAI-compatible chat queue.
 * Caps concurrent calls at 4 so the local LLM backend is not overloaded.
 *
 * Qwen3 / DeepSeek-R1 style models often emit long `reasoning_content` and only
 * fill `content` afterward. If max_tokens is too low, content is empty and
 * finish_reason=length — never post reasoning as chat text.
 */

import { DEFAULT_SETTINGS } from "@/lib/db/schema";
import { getSave } from "@/lib/server/sqliteSave";

export const LLM_ENV_BASE_URL =
  process.env.GATEWARS_LLM_BASE_URL ?? DEFAULT_SETTINGS.llmBaseUrl;
export const LLM_ENV_MODEL =
  process.env.GATEWARS_LLM_MODEL ?? DEFAULT_SETTINGS.llmModel;
export const LLM_ENV_API_KEY = process.env.GATEWARS_LLM_API_KEY ?? "";

/** @deprecated Prefer resolveLlmConfig() */
export const LLM_BASE_URL = LLM_ENV_BASE_URL;
/** @deprecated Prefer resolveLlmConfig() */
export const LLM_MODEL = LLM_ENV_MODEL;

export const LLM_MAX_CONCURRENT = 4;
export const LLM_TIMEOUT_MS = 180_000;
/** R1/Qwen3 burn tokens on reasoning; plans need headroom for JSON. */
export const LLM_DEFAULT_MAX_TOKENS = 3072;
/** Forum replies need room for hidden reasoning + short content. */
export const LLM_FORUM_MAX_TOKENS = 4096;
/** Private mail — long diplomatic replies; prompt may use up to 128k context. */
export const LLM_MAIL_MAX_TOKENS = 4096;
export const LLM_MAIL_CONTEXT_WINDOW = 128_000;
/** Model context window (tokens) — prompts should stay well under this. */
export const LLM_CONTEXT_WINDOW = 64_000;

export type LlmPurpose = "forum" | "mind" | "mail" | "general";

export type LlmRuntimeConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type QueueJob = {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  purpose: LlmPurpose;
  config: LlmRuntimeConfig;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
};

type LlmMessage = {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
};

const queue: QueueJob[] = [];
let active = 0;

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Effective LLM config: request override → SQLite save settings → env → defaults.
 */
export function resolveLlmConfig(override?: Partial<LlmRuntimeConfig>): LlmRuntimeConfig {
  const saved = getSave()?.settings;
  const baseUrl = normalizeBaseUrl(
    override?.baseUrl ||
      saved?.llmBaseUrl ||
      LLM_ENV_BASE_URL ||
      DEFAULT_SETTINGS.llmBaseUrl,
  );
  const model = (
    override?.model ||
    saved?.llmModel ||
    LLM_ENV_MODEL ||
    DEFAULT_SETTINGS.llmModel
  ).trim();
  const apiKey = (
    override?.apiKey ??
    saved?.llmApiKey ??
    LLM_ENV_API_KEY ??
    ""
  ).trim();
  return { baseUrl, model, apiKey };
}

export function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
}

/** Detect chain-of-thought / instruction meta that must never hit the forum. */
export function looksLikeReasoningLeak(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/<think>|<\/think>|thinking process\s*:/i.test(t)) return true;
  if (
    /\b(output only|system (persona )?instructions?|as per the (system|persona)|looking at the log again|this was a previous turn|in the simulation|i should just output|wait, reading it again|the instruction\b|recent channel messages|gatewars rules\b|analyze the request)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Long meta essays with backticks quoting prior posts
  if (t.length > 220 && /```|^\*wait/i.test(t) && /instruction|log again|simulation/i.test(t)) {
    return true;
  }
  // Pure planning bullets
  if (/^\s*\d+\.\s+\*\*/m.test(t) && /analyze|constraint|output/i.test(t)) {
    return true;
  }
  return false;
}

function extractJsonBlob(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = text.slice(start, end + 1).trim();
  try {
    JSON.parse(slice);
    return slice;
  } catch {
    return null;
  }
}

/**
 * Pull a usable final reply from R1/Qwen-style payloads.
 * Forum mode never falls back to reasoning_content (that was posting CoT to chat).
 */
export function extractAssistantText(
  message: LlmMessage | undefined,
  opts?: { purpose?: LlmPurpose },
): string {
  if (!message) return "";
  const purpose = opts?.purpose ?? "general";
  const content = stripThinkTags(String(message.content ?? "")).trim();
  if (content && !looksLikeReasoningLeak(content)) {
    return content;
  }
  // Content present but is leak — treat as empty for chat-like surfaces
  if (content && (purpose === "forum" || purpose === "mail")) return "";

  if (purpose === "forum" || purpose === "mail") {
    // Never surface reasoning as a guild/open/mail post
    return "";
  }

  const reasoning = stripThinkTags(
    String(message.reasoning_content ?? message.reasoning ?? ""),
  ).trim();
  if (!reasoning) return content; // may still be leaky content for mind retry

  // Mind/general: prefer a JSON object at the end of reasoning
  const json = extractJsonBlob(reasoning);
  if (json) return json;

  const paras = reasoning
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (let i = paras.length - 1; i >= 0; i--) {
    const p = paras[i]!;
    if (looksLikeReasoningLeak(p)) continue;
    if (
      /^(okay|hmm|let me|i should|the user|wait|first|so,|now,|thinking)/i.test(
        p,
      ) ||
      p.length < 12
    ) {
      continue;
    }
    return p.replace(/^(final\s*(answer|post|message)\s*[:\-–]\s*)/i, "").trim();
  }
  return "";
}

function tidyForumText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey || "gatewars"}`,
  };
}

async function callLlmOnce(
  job: QueueJob,
  maxTokens: number,
): Promise<{ text: string; finish?: string; reasoningTokens?: number }> {
  const { baseUrl, model, apiKey } = job.config;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: job.messages,
        temperature: job.temperature,
        max_tokens: maxTokens,
        stream: false,
        // Best-effort; many local servers ignore these, but harmless when accepted
        enable_thinking:
          job.purpose === "forum" || job.purpose === "mail" ? false : undefined,
        chat_template_kwargs:
          job.purpose === "forum" || job.purpose === "mail"
            ? { enable_thinking: false }
            : undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: LlmMessage;
        finish_reason?: string;
      }>;
      usage?: {
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const choice = data.choices?.[0];
    const raw = extractAssistantText(choice?.message, { purpose: job.purpose });
    const cleaned = tidyForumText(raw);
    return {
      text: cleaned,
      finish: choice?.finish_reason,
      reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callLlm(job: QueueJob): Promise<string> {
  try {
    let result = await callLlmOnce(job, job.maxTokens);

    // Reasoning models often exhaust the budget on CoT — retry once with more room
    if (
      !result.text &&
      (result.finish === "length" || (result.reasoningTokens ?? 0) > 0)
    ) {
      const bump = Math.min(job.maxTokens * 2, 8192);
      if (bump > job.maxTokens) {
        result = await callLlmOnce(job, bump);
      }
    }

    if (!result.text || looksLikeReasoningLeak(result.text)) {
      throw new Error(
        result.finish === "length"
          ? `LLM spent all tokens on hidden reasoning (finish=length). Raise max_tokens or disable thinking in the server UI.`
          : `Empty or invalid LLM response (finish=${result.finish ?? "?"})`,
      );
    }
    return result.text;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`LLM timed out after ${LLM_TIMEOUT_MS}ms`);
    }
    throw e;
  }
}

function pump(): void {
  while (active < LLM_MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!;
    active += 1;
    callLlm(job)
      .then((text) => job.resolve(text))
      .catch((err) =>
        job.reject(err instanceof Error ? err : new Error(String(err))),
      )
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

/** Enqueue a chat completion. Resolves when a slot is free and the model replies. */
export function enqueueChatCompletion(opts: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  purpose?: LlmPurpose;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}): Promise<string> {
  const purpose = opts.purpose ?? "general";
  const floor =
    purpose === "forum"
      ? LLM_FORUM_MAX_TOKENS
      : purpose === "mail"
        ? LLM_MAIL_MAX_TOKENS
        : LLM_DEFAULT_MAX_TOKENS;
  const config = resolveLlmConfig({
    baseUrl: opts.baseUrl,
    model: opts.model,
    apiKey: opts.apiKey,
  });
  return new Promise((resolve, reject) => {
    queue.push({
      messages: opts.messages,
      temperature: opts.temperature ?? 0.8,
      maxTokens: Math.max(opts.maxTokens ?? floor, floor),
      purpose,
      config,
      resolve,
      reject,
    });
    pump();
  });
}

/** List models from an OpenAI-compatible /models endpoint. */
export async function listLlmModels(
  override?: Partial<LlmRuntimeConfig>,
): Promise<string[]> {
  const { baseUrl, apiKey } = resolveLlmConfig(override);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: authHeaders(apiKey),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Models HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ id?: string }>;
    };
    const ids = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Listing models timed out");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function llmQueueStats() {
  return { active, queued: queue.length, max: LLM_MAX_CONCURRENT };
}
