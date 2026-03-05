import type { NextApiRequest, NextApiResponse } from "next";

import {
  upsertCategoryConfig,
  listCategoryConfigs,
} from "@/lib/category-config-store";
import type {
  ArrayItemSchemaType,
  CategoryConfig,
  CategoryConfigUpdateInput,
  CategoryFieldConfig,
  FieldSchemaType,
} from "@/lib/category-config";

type SuccessResponse =
  | {
      categories: CategoryConfig[];
    }
  | {
      category: CategoryConfig;
    };

type ErrorResponse = {
  error: string;
};

function parseSchemaType(value: unknown): FieldSchemaType {
  if (value === "string" || value === "number" || value === "boolean" || value === "array") {
    return value;
  }

  return "string";
}

function parseItemSchemaType(value: unknown): ArrayItemSchemaType | null {
  if (value === "string" || value === "number" || value === "boolean" || value === "object") {
    return value;
  }

  return null;
}

function parseField(value: unknown, index: number): CategoryFieldConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid field at index ${index}.`);
  }

  const input = value as Record<string, unknown>;

  return {
    fieldKey: String(input.fieldKey ?? "").trim(),
    fieldLabel: String(input.fieldLabel ?? "").trim(),
    schemaType: parseSchemaType(input.schemaType),
    itemSchemaType: parseItemSchemaType(input.itemSchemaType),
    promptDescription: String(input.promptDescription ?? "").trim(),
    required: Boolean(input.required),
    displayOrder: Number.isFinite(Number(input.displayOrder)) ? Number(input.displayOrder) : index,
  };
}

function parseCategoryPayload(payload: unknown): CategoryConfigUpdateInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid payload.");
  }

  const input = payload as Record<string, unknown>;
  const fieldsRaw = Array.isArray(input.fields) ? input.fields : [];

  return {
    id: String(input.id ?? "").trim(),
    label: String(input.label ?? "").trim(),
    description: String(input.description ?? "").trim(),
    parserType: String(input.parserType ?? "").trim(),
    allowFile: Boolean(input.allowFile),
    requiresFile: Boolean(input.requiresFile),
    fileLabel: String(input.fileLabel ?? "").trim(),
    fileAccept: String(input.fileAccept ?? "").trim(),
    linkFieldLabel: String(input.linkFieldLabel ?? "").trim(),
    textFieldLabel: String(input.textFieldLabel ?? "").trim(),
    captionFieldLabel: String(input.captionFieldLabel ?? "").trim(),
    aiSystemPrompt: String(input.aiSystemPrompt ?? "").trim(),
    aiTaskPrompt: String(input.aiTaskPrompt ?? "").trim(),
    commonFormatTemplate: String(input.commonFormatTemplate ?? "").trim(),
    isActive: input.isActive === undefined ? true : Boolean(input.isActive),
    fields: fieldsRaw.map((field, index) => parseField(field, index)),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  try {
    if (req.method === "GET") {
      const categories = await listCategoryConfigs();
      res.status(200).json({ categories });
      return;
    }

    if (req.method === "PUT") {
      const category = parseCategoryPayload(req.body);
      await upsertCategoryConfig(category);
      res.status(200).json({ category });
      return;
    }

    res.setHeader("Allow", ["GET", "PUT"]);
    res.status(405).json({ error: "Method Not Allowed" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Configuration API error.";
    res.status(400).json({ error: message });
  }
}
