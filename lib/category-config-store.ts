import { type InStatement } from "@libsql/client";

import {
  sortFields,
  type ArrayItemSchemaType,
  type CategoryConfig,
  type CategoryConfigUpdateInput,
  type CategoryFieldConfig,
  type FieldSchemaType,
} from "@/lib/category-config";
import { getTursoClient } from "@/lib/turso";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS category_configs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      parser_type TEXT NOT NULL,
      allow_file INTEGER NOT NULL DEFAULT 1,
      requires_file INTEGER NOT NULL DEFAULT 0,
      file_label TEXT NOT NULL DEFAULT '',
      file_accept TEXT NOT NULL DEFAULT '',
      link_field_label TEXT NOT NULL DEFAULT '',
      text_field_label TEXT NOT NULL DEFAULT '',
      caption_field_label TEXT NOT NULL DEFAULT '',
      ai_system_prompt TEXT NOT NULL,
      ai_task_prompt TEXT NOT NULL,
      common_format_template TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  `CREATE TABLE IF NOT EXISTS category_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id TEXT NOT NULL,
      field_key TEXT NOT NULL,
      field_label TEXT NOT NULL,
      schema_type TEXT NOT NULL DEFAULT 'string',
      item_schema_type TEXT,
      prompt_description TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES category_configs(id) ON DELETE CASCADE,
      UNIQUE (category_id, field_key)
    )`,
  `CREATE INDEX IF NOT EXISTS idx_category_fields_category_order ON category_fields(category_id, display_order, id)`,
];

let schemaReady = false;

function asString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "bigint") {
    return value !== BigInt(0);
  }

  return String(value) === "1" || String(value).toLowerCase() === "true";
}

function asSchemaType(value: unknown): FieldSchemaType {
  const normalized = asString(value, "string") as FieldSchemaType;
  if (normalized === "string" || normalized === "number" || normalized === "boolean" || normalized === "array") {
    return normalized;
  }

  return "string";
}

function asArrayItemSchemaType(value: unknown): ArrayItemSchemaType | null {
  const normalized = asString(value, "");

  if (
    normalized === "string" ||
    normalized === "number" ||
    normalized === "boolean" ||
    normalized === "object"
  ) {
    return normalized;
  }

  return null;
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  const client = getTursoClient();
  const statements: InStatement[] = SCHEMA_STATEMENTS.map((sql) => ({ sql }));
  await client.batch(statements, "write");
  schemaReady = true;
}

function buildCategoryMap(categoryRows: Array<Record<string, unknown>>): Map<string, CategoryConfig> {
  const map = new Map<string, CategoryConfig>();

  for (const row of categoryRows) {
    const id = asString(row.id);

    map.set(id, {
      id,
      label: asString(row.label),
      description: asString(row.description),
      parserType: asString(row.parser_type),
      allowFile: asBoolean(row.allow_file),
      requiresFile: asBoolean(row.requires_file),
      fileLabel: asString(row.file_label),
      fileAccept: asString(row.file_accept),
      linkFieldLabel: asString(row.link_field_label),
      textFieldLabel: asString(row.text_field_label),
      captionFieldLabel: asString(row.caption_field_label),
      aiSystemPrompt: asString(row.ai_system_prompt),
      aiTaskPrompt: asString(row.ai_task_prompt),
      commonFormatTemplate: asString(row.common_format_template),
      isActive: asBoolean(row.is_active),
      fields: [],
    });
  }

  return map;
}

function attachFields(
  categoryMap: Map<string, CategoryConfig>,
  fieldRows: Array<Record<string, unknown>>,
): void {
  for (const row of fieldRows) {
    const categoryId = asString(row.category_id);
    const category = categoryMap.get(categoryId);

    if (!category) {
      continue;
    }

    const field: CategoryFieldConfig = {
      fieldKey: asString(row.field_key),
      fieldLabel: asString(row.field_label),
      schemaType: asSchemaType(row.schema_type),
      itemSchemaType: asArrayItemSchemaType(row.item_schema_type),
      promptDescription: asString(row.prompt_description),
      required: asBoolean(row.required),
      displayOrder: Number(row.display_order ?? 0),
    };

    category.fields.push(field);
  }

  for (const category of categoryMap.values()) {
    category.fields = sortFields(category.fields);
  }
}

export async function listCategoryConfigs(): Promise<CategoryConfig[]> {
  await ensureSchema();

  const client = getTursoClient();
  const categoryResult = await client.execute(
    `SELECT id, label, description, parser_type, allow_file, requires_file, file_label, file_accept,
            link_field_label, text_field_label, caption_field_label, ai_system_prompt, ai_task_prompt,
            common_format_template, is_active
     FROM category_configs
     WHERE is_active = 1
     ORDER BY label`,
  );

  const categoryMap = buildCategoryMap(categoryResult.rows as Array<Record<string, unknown>>);

  if (!categoryMap.size) {
    return [];
  }

  const fieldResult = await client.execute(
    `SELECT category_id, field_key, field_label, schema_type, item_schema_type, prompt_description,
            required, display_order
     FROM category_fields
     ORDER BY category_id, display_order, id`,
  );

  attachFields(categoryMap, fieldResult.rows as Array<Record<string, unknown>>);

  return [...categoryMap.values()];
}

export async function getCategoryConfigById(id: string): Promise<CategoryConfig | null> {
  await ensureSchema();

  const client = getTursoClient();
  const categoryResult = await client.execute({
    sql: `SELECT id, label, description, parser_type, allow_file, requires_file, file_label, file_accept,
                 link_field_label, text_field_label, caption_field_label, ai_system_prompt, ai_task_prompt,
                 common_format_template, is_active
          FROM category_configs
          WHERE id = ?
          LIMIT 1`,
    args: [id],
  });

  const categoryRows = categoryResult.rows as Array<Record<string, unknown>>;

  if (!categoryRows.length) {
    return null;
  }

  const categoryMap = buildCategoryMap(categoryRows);

  const fieldResult = await client.execute({
    sql: `SELECT category_id, field_key, field_label, schema_type, item_schema_type, prompt_description,
                 required, display_order
          FROM category_fields
          WHERE category_id = ?
          ORDER BY display_order, id`,
    args: [id],
  });

  attachFields(categoryMap, fieldResult.rows as Array<Record<string, unknown>>);

  return categoryMap.get(id) ?? null;
}

function validateCategoryConfigInput(input: CategoryConfigUpdateInput): void {
  if (!input.id.trim()) {
    throw new Error("Category id is required.");
  }

  if (!input.label.trim()) {
    throw new Error("Category label is required.");
  }

  if (!input.fields.length) {
    throw new Error("At least one field is required in a category.");
  }

  const seen = new Set<string>();

  for (const field of input.fields) {
    if (!field.fieldKey.trim()) {
      throw new Error("Field key is required.");
    }

    if (!field.fieldLabel.trim()) {
      throw new Error(`Field label is required for key ${field.fieldKey}.`);
    }

    if (!field.promptDescription.trim()) {
      throw new Error(`Prompt description is required for field ${field.fieldKey}.`);
    }

    if (seen.has(field.fieldKey)) {
      throw new Error(`Duplicate field key: ${field.fieldKey}.`);
    }

    seen.add(field.fieldKey);
  }
}

export async function upsertCategoryConfig(input: CategoryConfigUpdateInput): Promise<void> {
  await ensureSchema();
  validateCategoryConfigInput(input);

  const client = getTursoClient();
  const sortedFields = sortFields(input.fields);

  const statements: InStatement[] = [
    {
      sql: `INSERT INTO category_configs (
              id, label, description, parser_type, allow_file, requires_file, file_label, file_accept,
              link_field_label, text_field_label, caption_field_label, ai_system_prompt, ai_task_prompt,
              common_format_template, is_active, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              label = excluded.label,
              description = excluded.description,
              parser_type = excluded.parser_type,
              allow_file = excluded.allow_file,
              requires_file = excluded.requires_file,
              file_label = excluded.file_label,
              file_accept = excluded.file_accept,
              link_field_label = excluded.link_field_label,
              text_field_label = excluded.text_field_label,
              caption_field_label = excluded.caption_field_label,
              ai_system_prompt = excluded.ai_system_prompt,
              ai_task_prompt = excluded.ai_task_prompt,
              common_format_template = excluded.common_format_template,
              is_active = excluded.is_active,
              updated_at = CURRENT_TIMESTAMP`,
      args: [
        input.id,
        input.label,
        input.description,
        input.parserType,
        input.allowFile ? 1 : 0,
        input.requiresFile ? 1 : 0,
        input.fileLabel,
        input.fileAccept,
        input.linkFieldLabel,
        input.textFieldLabel,
        input.captionFieldLabel,
        input.aiSystemPrompt,
        input.aiTaskPrompt,
        input.commonFormatTemplate,
        input.isActive ? 1 : 0,
      ],
    },
    {
      sql: `DELETE FROM category_fields WHERE category_id = ?`,
      args: [input.id],
    },
  ];

  for (let index = 0; index < sortedFields.length; index += 1) {
    const field = sortedFields[index];

    statements.push({
      sql: `INSERT INTO category_fields (
              category_id, field_key, field_label, schema_type, item_schema_type,
              prompt_description, required, display_order, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [
        input.id,
        field.fieldKey,
        field.fieldLabel,
        field.schemaType,
        field.itemSchemaType ?? null,
        field.promptDescription,
        field.required ? 1 : 0,
        Number.isFinite(field.displayOrder) ? field.displayOrder : index,
      ],
    });
  }

  await client.batch(statements, "write");
}
