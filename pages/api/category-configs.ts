import type { NextApiRequest, NextApiResponse } from "next";

import {
  upsertCategoryConfig,
  listCategoryConfigs,
  deleteCategoryConfig,
} from "@/lib/category-config-store";
import {
  DEFAULT_KEYWORD_DELIMITER,
  DEFAULT_OCR_ENGINE,
  normalizeKeywordDelimiter,
  type ArrayItemSchemaType,
  type CategoryConfig,
  type CategoryConfigUpdateInput,
  type CategoryFieldConfig,
  type FieldSchemaType,
} from "@/lib/category-config";
import { getSessionUser, userCanManageCategory } from "@/lib/auth";

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
    isKeyword: Boolean(input.isKeyword),
  };
}

function parseModelsInput(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
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
    defaultOcrEngine: String(input.defaultOcrEngine ?? DEFAULT_OCR_ENGINE).trim() || DEFAULT_OCR_ENGINE,
    defaultModels: parseModelsInput(input.defaultModels),
    enableWebSearch: Boolean(input.enableWebSearch),
    keywordDelimiter: normalizeKeywordDelimiter(
      typeof input.keywordDelimiter === "string" ? input.keywordDelimiter : DEFAULT_KEYWORD_DELIMITER,
    ),
    fields: fieldsRaw.map((field, index) => parseField(field, index)),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  try {
    const user = await getSessionUser(req);

    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (req.method === "GET") {
      const all = await listCategoryConfigs();
      // Non-admins only see categories they were granted access to.
      const categories =
        user.role === "user"
          ? all.filter((category) => user.categoryAccess.includes(category.id))
          : all;
      res.status(200).json({ categories });
      return;
    }

    if (req.method === "PUT") {
      const category = parseCategoryPayload(req.body);
      const isNew = !(await listCategoryConfigs()).some((existing) => existing.id === category.id);

      if (isNew && !user.canCreateCategories) {
        res.status(403).json({ error: "You do not have permission to create new categories." });
        return;
      }

      if (!isNew && !userCanManageCategory(user, category.id)) {
        res.status(403).json({ error: "You do not have permission to edit this category." });
        return;
      }

      await upsertCategoryConfig(category);
      res.status(200).json({ category });
      return;
    }

    if (req.method === "DELETE") {
      const id = String(req.query.id ?? "").trim();

      if (!id) {
        res.status(400).json({ error: "Missing category id." });
        return;
      }

      if (!userCanManageCategory(user, id)) {
        res.status(403).json({ error: "You do not have permission to delete this category." });
        return;
      }

      await deleteCategoryConfig(id);
      res.status(200).json({ category: { id } as CategoryConfig });
      return;
    }

    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    res.status(405).json({ error: "Method Not Allowed" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Configuration API error.";
    res.status(400).json({ error: message });
  }
}
