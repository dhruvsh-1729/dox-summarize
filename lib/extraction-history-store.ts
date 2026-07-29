import crypto from "node:crypto";

import { type InStatement } from "@libsql/client";

import type { CategoryConfig, CategoryFieldConfig, RowData } from "@/lib/category-config";
import { getTursoClient } from "@/lib/turso";

type StoredOcrMeta = {
  engine?: string | null;
  numPages?: number | null;
  credits?: number | null;
  jobId?: string | null;
};

type StoredModelResult = {
  model: string;
  ok: boolean;
  row?: RowData;
  commonFormat?: string;
  error?: string;
  usage?: unknown;
  latencyMs?: number;
};

export type SaveExtractionHistoryInput = {
  category: CategoryConfig;
  userId: string;
  fileName?: string | null;
  models: string[];
  webSearch: boolean;
  ocr?: StoredOcrMeta;
  results: StoredModelResult[];
};

export type FieldValueSuggestion = {
  fieldKey: string;
  fieldLabel: string;
  value: string;
  usageCount: number;
  latestAt: string;
};

export type FieldValueSuggestionMap = Record<string, FieldValueSuggestion[]>;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS extraction_runs (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      category_label TEXT NOT NULL DEFAULT '',
      user_id TEXT,
      file_name TEXT,
      models TEXT NOT NULL DEFAULT '',
      web_search INTEGER NOT NULL DEFAULT 0,
      ocr_engine TEXT,
      ocr_pages INTEGER,
      ocr_credits REAL,
      ocr_job_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  `CREATE INDEX IF NOT EXISTS idx_extraction_runs_category_created
     ON extraction_runs(category_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS extraction_model_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      model TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 0,
      row_json TEXT NOT NULL DEFAULT '',
      common_format TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL DEFAULT '',
      latency_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES extraction_runs(id) ON DELETE CASCADE
    )`,
  `CREATE INDEX IF NOT EXISTS idx_extraction_model_outputs_run
     ON extraction_model_outputs(run_id, id)`,
  `CREATE TABLE IF NOT EXISTS extraction_field_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      category_label TEXT NOT NULL DEFAULT '',
      field_key TEXT NOT NULL,
      field_label TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      normalized_value TEXT NOT NULL DEFAULT '',
      is_available INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES extraction_runs(id) ON DELETE CASCADE
    )`,
  `CREATE INDEX IF NOT EXISTS idx_extraction_field_values_category_field_created
     ON extraction_field_values(category_id, field_key, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_extraction_field_values_suggestions
     ON extraction_field_values(category_id, field_key, is_available, normalized_value)`,
];

let schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  const client = getTursoClient();
  await client.batch(
    SCHEMA_STATEMENTS.map((sql) => ({ sql })),
    "write",
  );
  schemaReady = true;
}

function safeJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function normalizeStoredValue(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isStoredValueAvailable(value: string | undefined | null): boolean {
  const normalized = normalizeStoredValue(value ?? "").replace(/[.]+$/g, "");

  if (!normalized) {
    return false;
  }

  return !new Set(["not available", "n/a", "na", "none", "null", "-"]).has(normalized);
}

function fieldLabelByKey(fields: CategoryFieldConfig[]): Map<string, string> {
  return new Map(fields.map((field) => [field.fieldKey, field.fieldLabel]));
}

function asString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value ?? 0);
}

export async function saveExtractionHistory(input: SaveExtractionHistoryInput): Promise<string> {
  await ensureSchema();

  const runId = crypto.randomUUID();
  const client = getTursoClient();
  const labels = fieldLabelByKey(input.category.fields);
  const statements: InStatement[] = [
    {
      sql: `INSERT INTO extraction_runs (
              id, category_id, category_label, user_id, file_name, models, web_search,
              ocr_engine, ocr_pages, ocr_credits, ocr_job_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        runId,
        input.category.id,
        input.category.label,
        input.userId,
        input.fileName ?? null,
        input.models.join(","),
        input.webSearch ? 1 : 0,
        input.ocr?.engine ?? null,
        input.ocr?.numPages ?? null,
        input.ocr?.credits ?? null,
        input.ocr?.jobId ?? null,
      ],
    },
  ];

  for (const result of input.results) {
    statements.push({
      sql: `INSERT INTO extraction_model_outputs (
              run_id, category_id, model, ok, row_json, common_format, error, usage_json, latency_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        runId,
        input.category.id,
        result.model,
        result.ok ? 1 : 0,
        safeJson(result.row),
        result.commonFormat ?? "",
        result.error ?? "",
        safeJson(result.usage),
        result.latencyMs ?? null,
      ],
    });

    if (!result.ok || !result.row) {
      continue;
    }

    for (const [fieldKey, value] of Object.entries(result.row)) {
      const storedValue = String(value ?? "").trim();
      const normalizedValue = normalizeStoredValue(storedValue);

      statements.push({
        sql: `INSERT INTO extraction_field_values (
                run_id, category_id, category_label, field_key, field_label, model,
                value, normalized_value, is_available
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          runId,
          input.category.id,
          input.category.label,
          fieldKey,
          labels.get(fieldKey) ?? fieldKey,
          result.model,
          storedValue,
          normalizedValue,
          isStoredValueAvailable(storedValue) ? 1 : 0,
        ],
      });
    }
  }

  await client.batch(statements, "write");
  return runId;
}

export async function listFieldValueSuggestions(
  categoryId: string,
  limitPerField = 50,
): Promise<FieldValueSuggestionMap> {
  await ensureSchema();

  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT field_key, field_label, value, usage_count, latest_at
          FROM (
            SELECT
              field_key,
              field_label,
              value,
              normalized_value,
              COUNT(*) OVER (PARTITION BY field_key, normalized_value) AS usage_count,
              MAX(created_at) OVER (PARTITION BY field_key, normalized_value) AS latest_at,
              ROW_NUMBER() OVER (
                PARTITION BY field_key, normalized_value
                ORDER BY created_at DESC, id DESC
              ) AS row_number
            FROM extraction_field_values
            WHERE category_id = ?
              AND is_available = 1
              AND normalized_value != ''
          )
          WHERE row_number = 1
          ORDER BY latest_at DESC
          LIMIT ?`,
    args: [categoryId, Math.max(limitPerField * 100, 100)],
  });

  const suggestions: FieldValueSuggestionMap = {};

  for (const row of result.rows as Array<Record<string, unknown>>) {
    const fieldKey = asString(row.field_key);
    const list = suggestions[fieldKey] ?? [];

    if (list.length >= limitPerField) {
      continue;
    }

    list.push({
      fieldKey,
      fieldLabel: asString(row.field_label, fieldKey),
      value: asString(row.value),
      usageCount: asNumber(row.usage_count),
      latestAt: asString(row.latest_at),
    });
    suggestions[fieldKey] = list;
  }

  return suggestions;
}
