export type WorkflowCategoryId = string;

export type ParserType =
  | "newspaper_pdf"
  | "photo_image"
  | "e_paper_link"
  | "correspondence"
  | "social_post"
  | string;

export type FieldSchemaType = "string" | "number" | "boolean" | "array";

export type ArrayItemSchemaType = "string" | "number" | "boolean" | "object";

export type OcrEngine = "paddle" | "reducto" | string;

export type CategoryFieldConfig = {
  fieldKey: string;
  fieldLabel: string;
  schemaType: FieldSchemaType;
  itemSchemaType?: ArrayItemSchemaType | null;
  promptDescription: string;
  required: boolean;
  displayOrder: number;
  /** When true, the field is treated as a keyword list and joined using the category keywordDelimiter. */
  isKeyword: boolean;
};

export type CategoryConfig = {
  id: WorkflowCategoryId;
  label: string;
  description: string;
  parserType: ParserType;
  allowFile: boolean;
  requiresFile: boolean;
  fileLabel: string;
  fileAccept: string;
  linkFieldLabel: string;
  textFieldLabel: string;
  captionFieldLabel: string;
  aiSystemPrompt: string;
  aiTaskPrompt: string;
  commonFormatTemplate: string;
  isActive: boolean;
  /** Default OCR/parse engine for file inputs in this category. */
  defaultOcrEngine: OcrEngine;
  /** Default OpenRouter model ids used when the user does not override. */
  defaultModels: string[];
  /** Whether web search augmentation is enabled by default for this category. */
  enableWebSearch: boolean;
  /** Single character used to join keyword-field arrays (e.g. "/", ",", "-"). */
  keywordDelimiter: string;
  fields: CategoryFieldConfig[];
};

export const DEFAULT_KEYWORD_DELIMITER = "/";
export const DEFAULT_OCR_ENGINE: OcrEngine = "paddle";

/** Normalizes a user-provided delimiter to a single, safe character. */
export function normalizeKeywordDelimiter(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return DEFAULT_KEYWORD_DELIMITER;
  }
  return trimmed.slice(0, 1);
}

/** Splits a raw keyword string by any of the common delimiters into clean tokens. */
export function splitKeywords(value: string, delimiter: string): string[] {
  const delimiters = new Set(["/", ",", "-", "|", ";", "\n", normalizeKeywordDelimiter(delimiter)]);
  const pattern = new RegExp(`[${[...delimiters].map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("")}]`);
  return value
    .split(pattern)
    .map((token) => token.trim())
    .filter(Boolean);
}

export type CategoryConfigUpdateInput = CategoryConfig;

export type RowData = Record<string, string>;

function templateValue(value: string | undefined): string {
  if (!value || !value.trim()) {
    return "Not available";
  }

  return value.trim();
}

export function renderCommonFormat(template: string, row: RowData): string {
  if (!template || !template.trim()) {
    return row.Matter ? `Matter - ${templateValue(row.Matter)}` : "Matter - Not available";
  }

  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, fieldKey: string) =>
    templateValue(row[fieldKey]),
  );
}

export function sortFields(fields: CategoryFieldConfig[]): CategoryFieldConfig[] {
  return [...fields].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) {
      return a.displayOrder - b.displayOrder;
    }

    return a.fieldKey.localeCompare(b.fieldKey);
  });
}
