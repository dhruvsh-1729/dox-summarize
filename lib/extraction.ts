import {
  normalizeKeywordDelimiter,
  sortFields,
  splitKeywords,
  type CategoryConfig,
  type CategoryFieldConfig,
  type FieldSchemaType,
  type RowData,
} from "@/lib/category-config";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function coerceCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(coerceCell).filter(Boolean).join(", ");
  }
  return JSON.stringify(value);
}

/** OpenRouter/Reducto structured outputs sometimes wrap values as {value, citations}. */
export function unwrapCitations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(unwrapCitations);
  }
  if (!isRecord(value)) {
    return value;
  }
  if ("value" in value && "citations" in value) {
    return unwrapCitations(value.value);
  }
  const unwrapped: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    unwrapped[key] = unwrapCitations(nestedValue);
  }
  return unwrapped;
}

function normalizeArrayValue(value: unknown, delimiter: string): string {
  if (!Array.isArray(value)) {
    // A model may already return delimiter-joined text.
    return coerceCell(value);
  }

  const pieces = value
    .map((entry) => {
      if (isRecord(entry)) {
        if (typeof entry.tag === "string") return entry.tag.trim();
        if (typeof entry.value === "string") return entry.value.trim();
      }
      return coerceCell(entry);
    })
    .filter(Boolean);

  return pieces.join(` ${delimiter} `);
}

function normalizeValueByType(value: unknown, schemaType: FieldSchemaType, delimiter: string): string {
  if (schemaType === "array") {
    return normalizeArrayValue(value, delimiter);
  }
  return coerceCell(value);
}

/** Converts an arbitrary model/parse output into a flat row of strings keyed by fieldKey. */
export function normalizeRow(raw: unknown, category: CategoryConfig): RowData {
  const row: RowData = {};
  const orderedFields = sortFields(category.fields);
  const delimiter = normalizeKeywordDelimiter(category.keywordDelimiter);
  const unwrapped = unwrapCitations(raw);

  const base = Array.isArray(unwrapped) ? unwrapped.find((entry) => isRecord(entry)) : unwrapped;
  const record = isRecord(base) ? base : {};

  for (const field of orderedFields) {
    let value = normalizeValueByType(record[field.fieldKey], field.schemaType, delimiter);

    // Keyword fields are always normalized to delimiter-separated tokens.
    if (field.isKeyword && value && value !== "Not available") {
      value = splitKeywords(value, delimiter).join(` ${delimiter} `);
    }

    row[field.fieldKey] = value || "Not available";
  }

  return row;
}

/* -------------------------------------------------------------------------- */
/* JSON schema + prompt scaffolding                                            */
/* -------------------------------------------------------------------------- */

export function buildFieldJsonSchema(field: CategoryFieldConfig): Record<string, unknown> {
  if (field.schemaType === "array") {
    return {
      type: "array",
      description: field.promptDescription,
      items: { type: field.itemSchemaType ?? "string" },
    };
  }
  return { type: field.schemaType, description: field.promptDescription };
}

export function buildJsonSchemaObject(category: CategoryConfig): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of sortFields(category.fields)) {
    properties[field.fieldKey] = buildFieldJsonSchema(field);
    // For strict structured outputs every property must be listed as required.
    required.push(field.fieldKey);
  }

  return { type: "object", properties, required, additionalProperties: false };
}

export function buildShape(category: CategoryConfig): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const field of sortFields(category.fields)) {
    shape[field.fieldKey] = field.schemaType === "array" ? ["Not available"] : "Not available";
  }
  return shape;
}

export function buildFieldGuide(category: CategoryConfig): string {
  const delimiter = normalizeKeywordDelimiter(category.keywordDelimiter);
  return sortFields(category.fields)
    .map((field) => {
      const arrayInfo =
        field.schemaType === "array" ? `<${field.itemSchemaType ?? "string"}>[]` : field.schemaType;
      const keywordNote = field.isKeyword
        ? ` (keyword list — separate values with "${delimiter}")`
        : "";
      return `- ${field.fieldKey} (${field.fieldLabel}) [${arrayInfo}]${field.required ? " required" : " optional"}${keywordNote}: ${field.promptDescription}`;
    })
    .join("\n");
}

/** Robustly extracts a JSON object from a possibly-fenced model response. */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to fenced / brace scanning
  }

  const cleaned = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Model returned non-JSON output.");
  }

  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}
