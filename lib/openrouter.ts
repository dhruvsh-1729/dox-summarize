import {
  buildFieldGuide,
  buildJsonSchemaObject,
  buildShape,
  extractJsonObject,
  normalizeRow,
} from "@/lib/extraction";
import { type CategoryConfig, type RowData } from "@/lib/category-config";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export type ModelUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number | null;
};

export type ModelRunResult = {
  model: string;
  ok: boolean;
  row?: RowData;
  error?: string;
  usage?: ModelUsage;
  /** Milliseconds the request took, useful when comparing models. */
  latencyMs?: number;
};

export type OpenRouterModelInfo = {
  id: string;
  name: string;
  contextLength?: number;
  promptPrice?: string;
  completionPrice?: string;
};

function getApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY in server environment.");
  }
  return apiKey;
}

function referrerHeaders(): Record<string, string> {
  // OpenRouter recommends these attribution headers; both are optional.
  const headers: Record<string, string> = {};
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  headers["X-Title"] = process.env.OPENROUTER_APP_NAME ?? "Dynamic Media Extractor";
  return headers;
}

export async function listOpenRouterModels(): Promise<OpenRouterModelInfo[]> {
  const response = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { Authorization: `Bearer ${getApiKey()}`, ...referrerHeaders() },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter models request failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };

  return (payload.data ?? []).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    contextLength: model.context_length,
    promptPrice: model.pricing?.prompt,
    completionPrice: model.pricing?.completion,
  }));
}

type RunArgs = {
  category: CategoryConfig;
  context: string;
  webSearch: boolean;
  webMaxResults?: number;
};

function buildMessages(category: CategoryConfig, context: string) {
  const shape = buildShape(category);
  const fieldGuide = buildFieldGuide(category);

  const systemPrompt =
    category.aiSystemPrompt ||
    "You extract structured information and return strict JSON only. If a value is unavailable, use \"Not available\".";

  const userPrompt = [
    `Task: ${category.aiTaskPrompt || "Extract the configured fields from the source."}`,
    "Return exactly one JSON object matching this shape (keys must match exactly):",
    JSON.stringify(shape, null, 2),
    "Field guidance:",
    fieldGuide,
    "Rules:",
    "1. Return ONLY a single JSON object, no markdown, no commentary.",
    "2. Keep output in English while preserving proper names.",
    "3. If a value is not present in the source, use \"Not available\".",
    "Source context:",
    context,
  ].join("\n\n");

  return [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];
}

/** Runs a single model through OpenRouter and normalizes the result into a row. */
export async function runModel(model: string, args: RunArgs): Promise<ModelRunResult> {
  const startedAt = Date.now();

  try {
    const body: Record<string, unknown> = {
      model,
      temperature: 0,
      messages: buildMessages(args.category, args.context),
      // Ask for structured JSON. Models that don't support json_schema still
      // honor the prompt instructions, and extractJsonObject cleans up the rest.
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extraction",
          strict: true,
          schema: buildJsonSchemaObject(args.category),
        },
      },
      usage: { include: true },
    };

    if (args.webSearch) {
      body.plugins = [{ id: "web", max_results: args.webMaxResults ?? 5 }];
    }

    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
        ...referrerHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const failureText = await response.text();
      throw new Error(`OpenRouter error (${response.status}): ${failureText.slice(0, 400)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number | null;
      };
    };

    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Model returned an empty response.");
    }

    const parsed = extractJsonObject(content);
    const row = normalizeRow(parsed, args.category);

    return {
      model,
      ok: true,
      row,
      latencyMs: Date.now() - startedAt,
      usage: {
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens,
        totalTokens: payload.usage?.total_tokens,
        cost: payload.usage?.cost ?? null,
      },
    };
  } catch (error: unknown) {
    return {
      model,
      ok: false,
      error: error instanceof Error ? error.message : "Model run failed.",
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Runs several models concurrently so their outputs can be compared side by side. */
export async function runModels(models: string[], args: RunArgs): Promise<ModelRunResult[]> {
  const unique = [...new Set(models.map((model) => model.trim()).filter(Boolean))];

  if (!unique.length) {
    throw new Error("Select at least one model to run.");
  }

  return Promise.all(unique.map((model) => runModel(model, args)));
}
