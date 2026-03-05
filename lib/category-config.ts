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

export type CategoryFieldConfig = {
  fieldKey: string;
  fieldLabel: string;
  schemaType: FieldSchemaType;
  itemSchemaType?: ArrayItemSchemaType | null;
  promptDescription: string;
  required: boolean;
  displayOrder: number;
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
  fields: CategoryFieldConfig[];
};

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
