/**
 * Client helpers for AI mind thinking + forum via the queued LLM API.
 * Passes saved LLM endpoint/model so the server uses the player's settings.
 */

export type LlmClientOpts = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  purpose?: "forum" | "mind" | "mail" | "general";
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

function llmBody(opts: LlmClientOpts) {
  return {
    messages: [
      { role: "system" as const, content: opts.systemPrompt },
      { role: "user" as const, content: opts.userPrompt },
    ],
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    purpose: opts.purpose,
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.apiKey != null && opts.apiKey !== ""
      ? { apiKey: opts.apiKey }
      : {}),
  };
}

async function postLlm(
  opts: LlmClientOpts,
  defaults: {
    temperature: number;
    maxTokens: number;
    purpose: "forum" | "mind" | "mail" | "general";
  },
): Promise<{ text: string } | { error: string }> {
  try {
    const res = await fetch("/api/forum/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...llmBody({
          ...opts,
          temperature: opts.temperature ?? defaults.temperature,
          maxTokens: opts.maxTokens ?? defaults.maxTokens,
          purpose: opts.purpose ?? defaults.purpose,
        }),
      }),
    });
    const data = (await res.json()) as { text?: string; error?: string };
    if (!res.ok || !data.text) {
      return { error: data.error ?? `HTTP ${res.status}` };
    }
    return { text: data.text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function requestForumLlm(
  opts: LlmClientOpts,
): Promise<{ text: string } | { error: string }> {
  // High max_tokens: Qwen3/R1 spend most of the budget on hidden reasoning first
  return postLlm(opts, {
    temperature: 0.85,
    maxTokens: 4096,
    purpose: "forum",
  });
}

export async function requestMindLlm(
  opts: LlmClientOpts,
): Promise<{ text: string } | { error: string }> {
  return postLlm(opts, {
    temperature: 0.75,
    maxTokens: 4096,
    purpose: "mind",
  });
}

export async function requestMailLlm(
  opts: LlmClientOpts,
): Promise<{ text: string } | { error: string }> {
  // 128k context budget on the prompt side; completion still needs CoT headroom
  return postLlm(opts, {
    temperature: 0.8,
    maxTokens: 4096,
    purpose: "mail",
  });
}

export async function fetchLlmModels(opts?: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<{ models: string[]; error?: string }> {
  try {
    const res = await fetch("/api/forum/llm/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: opts?.baseUrl,
        apiKey: opts?.apiKey,
      }),
    });
    const data = (await res.json()) as {
      models?: string[];
      error?: string;
    };
    if (!res.ok) {
      return { models: data.models ?? [], error: data.error ?? `HTTP ${res.status}` };
    }
    return { models: data.models ?? [] };
  } catch (e) {
    return {
      models: [],
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}
