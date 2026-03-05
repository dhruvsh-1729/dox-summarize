import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { type File, type Fields, type Files } from "formidable";
import Reducto from "reductoai";

import {
  renderCommonFormat,
  sortFields,
  type CategoryConfig,
  type CategoryFieldConfig,
  type FieldSchemaType,
  type RowData,
} from "@/lib/category-config";
import { getCategoryConfigById } from "@/lib/category-config-store";

type ExtractSuccess = {
  categoryId: string;
  categoryLabel: string;
  row: RowData;
  fields: CategoryFieldConfig[];
  commonFormat: string;
  usage?: {
    numPages?: number;
    numFields?: number;
    credits?: number | null;
  };
  jobId?: string | null;
  fileName?: string | null;
};

type ExtractError = { error: string };

type ParseTextResult = {
  text: string;
  usage?: {
    numPages?: number;
    credits?: number | null;
  };
  jobId?: string;
};

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
]);

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff", ".bmp"];

const DEFAULT_PARSE_OPTIONS: Omit<Reducto.ParseRunParams.SyncParseConfig, "input"> = {
  enhance: {
    agentic: [{ scope: "text" }],
    summarize_figures: true,
  },
  formatting: {
    table_output_format: "md",
  },
  settings: {
    ocr_system: "standard",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceCell(value: unknown): string {
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

function unwrapCitations(value: unknown): unknown {
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

function normalizeArrayValue(value: unknown): string {
  if (!Array.isArray(value)) {
    return coerceCell(value);
  }

  const pieces = value
    .map((entry) => {
      if (isRecord(entry)) {
        if (typeof entry.tag === "string") {
          return entry.tag.trim();
        }

        if (typeof entry.value === "string") {
          return entry.value.trim();
        }
      }

      return coerceCell(entry);
    })
    .filter(Boolean);

  return pieces.join(", ");
}

function normalizeValueByType(value: unknown, schemaType: FieldSchemaType): string {
  if (schemaType === "array") {
    return normalizeArrayValue(value);
  }

  return coerceCell(value);
}

function normalizeRow(raw: unknown, fields: CategoryFieldConfig[]): RowData {
  const row: RowData = {};
  const orderedFields = sortFields(fields);
  const unwrapped = unwrapCitations(raw);

  const base = Array.isArray(unwrapped)
    ? unwrapped.find((entry) => isRecord(entry))
    : unwrapped;

  const record = isRecord(base) ? base : {};

  for (const field of orderedFields) {
    row[field.fieldKey] = normalizeValueByType(record[field.fieldKey], field.schemaType) || "Not available";
  }

  return row;
}

function toFirstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeFields(fields: Fields): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    const first = toFirstString(value);

    if (typeof first === "string") {
      normalized[key] = first.trim();
    }
  }

  return normalized;
}

function pickUploadedFile(files: Files): File | null {
  const ordered = [files.file, files.document, files.image, files.upload]
    .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((entry): entry is File => Boolean(entry));

  if (ordered.length) {
    return ordered[0];
  }

  const anyFile = Object.values(files)
    .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((entry): entry is File => Boolean(entry));

  return anyFile[0] ?? null;
}

async function parseMultipart(req: NextApiRequest): Promise<{
  fields: Record<string, string>;
  file: File | null;
}> {
  const form = formidable({
    allowEmptyFiles: false,
    maxFiles: 1,
    maxFileSize: MAX_UPLOAD_BYTES,
    multiples: false,
    filter: ({ mimetype, originalFilename }) => {
      if (!mimetype) {
        return true;
      }

      if (mimetype === "application/pdf") {
        return true;
      }

      if (IMAGE_MIME_TYPES.has(mimetype)) {
        return true;
      }

      if (!originalFilename) {
        return false;
      }

      const lower = originalFilename.toLowerCase();
      return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
    },
  });

  const { fields, files } = await new Promise<{ fields: Fields; files: Files }>((resolve, reject) => {
    form.parse(req, (error, parsedFields, parsedFiles) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields: parsedFields, files: parsedFiles });
    });
  });

  return {
    fields: normalizeFields(fields),
    file: pickUploadedFile(files),
  };
}

function getReductoClient(): Reducto {
  const apiKey = process.env.REDUCTO_API_KEY;

  if (!apiKey) {
    throw new Error("Missing REDUCTO_API_KEY in server environment.");
  }

  const environment = process.env.REDUCTO_ENVIRONMENT;
  const runtimeEnvironment =
    environment === "production" || environment === "eu" || environment === "au"
      ? environment
      : undefined;

  return new Reducto({
    apiKey,
    ...(runtimeEnvironment ? { environment: runtimeEnvironment } : {}),
    maxRetries: 2,
    timeout: 5 * 60 * 1000,
  });
}

function getSarvamApiKey(): string {
  const apiKey = process.env.SARVAM_API_KEY;

  if (!apiKey) {
    throw new Error("Missing SARVAM_API_KEY in server environment.");
  }

  return apiKey;
}

function isPdfFile(file: File): boolean {
  if (file.mimetype === "application/pdf") {
    return true;
  }

  return (file.originalFilename ?? "").toLowerCase().endsWith(".pdf");
}

function isImageFile(file: File): boolean {
  if (file.mimetype && IMAGE_MIME_TYPES.has(file.mimetype)) {
    return true;
  }

  const lower = (file.originalFilename ?? "").toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function buildFieldJsonSchema(field: CategoryFieldConfig): Record<string, unknown> {
  if (field.schemaType === "array") {
    const itemType = field.itemSchemaType ?? "string";

    return {
      type: "array",
      description: field.promptDescription,
      items: {
        type: itemType,
      },
    };
  }

  return {
    type: field.schemaType,
    description: field.promptDescription,
  };
}

function buildReductoInstructions(category: CategoryConfig): NonNullable<Reducto.ExtractRunParams.SyncExtractConfig["instructions"]> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of sortFields(category.fields)) {
    properties[field.fieldKey] = buildFieldJsonSchema(field);

    if (field.required) {
      required.push(field.fieldKey);
    }
  }

  return {
    schema: {
      type: "object",
      properties,
      required,
    },
    system_prompt: category.aiSystemPrompt,
  };
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // keep trying with fenced markdown
  }

  const cleaned = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Sarvam returned non-JSON output.");
  }

  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

function buildSarvamShape(fields: CategoryFieldConfig[]): Record<string, unknown> {
  const shape: Record<string, unknown> = {};

  for (const field of sortFields(fields)) {
    shape[field.fieldKey] = field.schemaType === "array" ? ["Not available"] : "Not available";
  }

  return shape;
}

function buildSarvamFieldGuide(fields: CategoryFieldConfig[]): string {
  return sortFields(fields)
    .map((field) => {
      const arrayInfo = field.schemaType === "array" ? `<${field.itemSchemaType ?? "string"}>[]` : field.schemaType;
      return `- ${field.fieldKey} (${field.fieldLabel}) [${arrayInfo}]${field.required ? " required" : " optional"}: ${field.promptDescription}`;
    })
    .join("\n");
}

function hasKeywordField(fields: CategoryFieldConfig[]): boolean {
  return fields.some((field) => /keyword/i.test(field.fieldKey) || /keyword/i.test(field.fieldLabel));
}

async function runSarvamExtraction(args: {
  category: CategoryConfig;
  context: string;
}): Promise<RowData> {
  const apiKey = getSarvamApiKey();
  const { category, context } = args;

  const fields = sortFields(category.fields);
  const shape = buildSarvamShape(fields);
  const fieldGuide = buildSarvamFieldGuide(fields);
  const keywordRule = hasKeywordField(fields)
    ? "If Keywords-like fields exist, include only proper nouns (person/org + designation/location when available)."
    : "";

  const response = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify({
      model: process.env.SARVAM_MODEL ?? "sarvam-m",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            category.aiSystemPrompt ||
            "You extract structured information and return strict JSON only. If unavailable, return Not available.",
        },
        {
          role: "user",
          content: [
            `Task: ${category.aiTaskPrompt || "Extract configured fields."}`,
            "Output keys must match exactly this JSON shape:",
            JSON.stringify(shape, null, 2),
            "Field guidance:",
            fieldGuide,
            "Rules:",
            "1. Return exactly one JSON object, no markdown.",
            "2. Keep output in English while preserving names.",
            keywordRule,
            "Source context:",
            context,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const failureText = await response.text();
    throw new Error(`Sarvam API error (${response.status}): ${failureText.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawContent = payload.choices?.[0]?.message?.content;

  if (typeof rawContent !== "string" || !rawContent.trim()) {
    throw new Error("Sarvam API returned an empty response.");
  }

  const parsed = extractJsonObject(rawContent);
  return normalizeRow(parsed, fields);
}

async function parseTextFromUploadedFile(filePath: string): Promise<ParseTextResult> {
  const client = getReductoClient();

  const upload = await client.upload({
    file: fs.createReadStream(filePath),
  });

  const parseResponse = await client.parse.run({
    input: upload,
    ...DEFAULT_PARSE_OPTIONS,
  });

  if (!("result" in parseResponse)) {
    throw new Error(`Parse started asynchronously. job_id=${parseResponse.job_id}`);
  }

  let text = "";

  if (parseResponse.result.type === "full") {
    text = parseResponse.result.chunks.map((chunk) => chunk.content).join("\n\n");
  } else {
    const remote = await fetch(parseResponse.result.url);

    if (!remote.ok) {
      throw new Error(`Could not fetch parse URL result (${remote.status}).`);
    }

    const remoteJson = (await remote.json()) as {
      chunks?: Array<{ content?: string }>;
    };

    text = (remoteJson.chunks ?? []).map((chunk) => chunk.content ?? "").join("\n\n");
  }

  return {
    text,
    usage: {
      numPages: parseResponse.usage.num_pages,
      credits: parseResponse.usage.credits,
    },
    jobId: parseResponse.job_id,
  };
}

function fieldByHint(fields: CategoryFieldConfig[], hint: RegExp): CategoryFieldConfig | undefined {
  return fields.find((field) => hint.test(field.fieldKey) || hint.test(field.fieldLabel));
}

async function processNewspaperPdf(file: File, category: CategoryConfig): Promise<{ row: RowData; usage?: ExtractSuccess["usage"]; jobId?: string | null }> {
  if (!isPdfFile(file)) {
    throw new Error("This category requires a PDF file.");
  }

  const client = getReductoClient();

  const upload = await client.upload({
    file: fs.createReadStream(file.filepath),
  });

  const extractResponse = await client.extract.run({
    input: upload,
    instructions: buildReductoInstructions(category),
    parsing: {
      enhance: {
        agentic: [{ scope: "text" }],
        summarize_figures: true,
      },
      formatting: {
        table_output_format: "md",
      },
      settings: {
        page_range: { start: 1, end: 2 },
        ocr_system: "standard",
      },
    },
    settings: {
      include_images: true,
      array_extract: true,
      optimize_for_latency: true,
      citations: {
        enabled: true,
        numerical_confidence: false,
      },
    },
  });

  if (!("result" in extractResponse)) {
    throw new Error(`Extraction started asynchronously. job_id=${extractResponse.job_id}`);
  }

  let row = normalizeRow(extractResponse.result, category.fields);

  const keywordField = fieldByHint(category.fields, /keyword/i);
  const matterField = fieldByHint(category.fields, /matter/i);
  const titleField = fieldByHint(category.fields, /title/i);

  if (keywordField && process.env.SARVAM_API_KEY && row[matterField?.fieldKey ?? ""]) {
    const keywordOnlyCategory: CategoryConfig = {
      ...category,
      aiTaskPrompt:
        "Generate only proper noun keywords with person/organization + designation/location where possible.",
      fields: [keywordField],
    };

    const keywordRow = await runSarvamExtraction({
      category: keywordOnlyCategory,
      context: [
        titleField ? `Title: ${row[titleField.fieldKey]}` : "",
        matterField ? `Matter: ${row[matterField.fieldKey]}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    row = {
      ...row,
      [keywordField.fieldKey]: keywordRow[keywordField.fieldKey] || row[keywordField.fieldKey],
    };
  }

  return {
    row,
    usage: {
      numPages: extractResponse.usage.num_pages,
      numFields: extractResponse.usage.num_fields,
      credits: extractResponse.usage.credits,
    },
    jobId: extractResponse.job_id,
  };
}

async function processPhotoImage(file: File, category: CategoryConfig): Promise<{ row: RowData; usage?: ExtractSuccess["usage"]; jobId?: string }> {
  if (!isImageFile(file) && !isPdfFile(file)) {
    throw new Error("This category requires an image or PDF upload.");
  }

  const parsed = await parseTextFromUploadedFile(file.filepath);
  const row = await runSarvamExtraction({
    category,
    context: parsed.text.slice(0, 20000),
  });

  return {
    row,
    usage: {
      numPages: parsed.usage?.numPages,
      credits: parsed.usage?.credits,
    },
    jobId: parsed.jobId,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractMetaContent(html: string, key: string): string {
  const escaped = escapeRegex(key);
  const withNameFirst = new RegExp(
    `<meta[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
    "i",
  );
  const withContentFirst = new RegExp(
    `<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*>`,
    "i",
  );

  const matched = html.match(withNameFirst)?.[1] ?? html.match(withContentFirst)?.[1] ?? "";

  return collapseWhitespace(decodeHtmlEntities(matched));
}

function findMetaFromHtml(html: string, ...keys: string[]): string {
  for (const key of keys) {
    const value = extractMetaContent(html, key);

    if (value) {
      return value;
    }
  }

  return "";
}

function extractHtmlTagContent(html: string, tagName: "article" | "main" | "body"): string {
  const matched = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return matched?.[1] ?? "";
}

function stripTagsToText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|article|section|br)>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return collapseWhitespace(decodeHtmlEntities(cleaned));
}

async function scrapeLink(link: string): Promise<{ finalUrl: string; title: string; author: string; date: string; language: string; siteName: string; content: string }> {
  const response = await fetch(link, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Could not fetch link (${response.status}).`);
  }

  const html = await response.text();
  const htmlLang = html.match(/<html[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const articleBlock = extractHtmlTagContent(html, "article");
  const mainBlock = extractHtmlTagContent(html, "main");
  const bodyBlock = extractHtmlTagContent(html, "body");
  const bestBlock = articleBlock || mainBlock || bodyBlock || html;
  const contentText = stripTagsToText(bestBlock);

  return {
    finalUrl: response.url,
    title:
      findMetaFromHtml(html, "og:title", "twitter:title", "title") ||
      collapseWhitespace(decodeHtmlEntities(titleTag)) ||
      "Not available",
    author:
      findMetaFromHtml(html, "author", "article:author", "twitter:creator", "parsely-author") ||
      "Not available",
    date:
      findMetaFromHtml(html, "article:published_time", "og:updated_time", "publish-date", "date") ||
      "Not available",
    language: collapseWhitespace(htmlLang) || findMetaFromHtml(html, "og:locale") || "Not available",
    siteName: findMetaFromHtml(html, "og:site_name", "application-name") || "Not available",
    content: contentText.slice(0, 40000) || "Not available",
  };
}

async function processEpaperLink(link: string, category: CategoryConfig): Promise<{ row: RowData }> {
  const scraped = await scrapeLink(link);

  const row = await runSarvamExtraction({
    category,
    context: [
      `Input link: ${link}`,
      `Final URL: ${scraped.finalUrl}`,
      `Detected title: ${scraped.title}`,
      `Detected author: ${scraped.author}`,
      `Detected date: ${scraped.date}`,
      `Detected site/newspaper: ${scraped.siteName}`,
      `Detected language hint: ${scraped.language}`,
      `Extracted content: ${scraped.content}`,
    ].join("\n\n"),
  });

  const contentField = fieldByHint(category.fields, /(content.*link|link.*content)/i);

  if (contentField && (!row[contentField.fieldKey] || row[contentField.fieldKey] === "Not available")) {
    row[contentField.fieldKey] = scraped.content || "Not available";
  }

  return { row };
}

async function processCorrespondence(args: {
  category: CategoryConfig;
  file: File | null;
  textInput: string;
}): Promise<{ row: RowData; usage?: ExtractSuccess["usage"]; jobId?: string }> {
  const contexts: string[] = [];
  let usage: ExtractSuccess["usage"] | undefined;
  let jobId: string | undefined;

  if (args.file) {
    const parsed = await parseTextFromUploadedFile(args.file.filepath);
    contexts.push(`Extracted document text:\n${parsed.text}`);
    usage = {
      numPages: parsed.usage?.numPages,
      credits: parsed.usage?.credits,
    };
    jobId = parsed.jobId;
  }

  if (args.textInput) {
    contexts.push(`Manual text:\n${args.textInput}`);
  }

  if (!contexts.length) {
    throw new Error("This category requires either an uploaded file or text input.");
  }

  const row = await runSarvamExtraction({
    category: args.category,
    context: contexts.join("\n\n"),
  });

  return { row, usage, jobId };
}

async function processSocialPost(args: {
  category: CategoryConfig;
  file: File | null;
  captionInput: string;
}): Promise<{ row: RowData; usage?: ExtractSuccess["usage"]; jobId?: string }> {
  if (!args.file && !args.captionInput) {
    throw new Error("This category requires caption text, image/PDF upload, or both.");
  }

  const contexts: string[] = [];
  let usage: ExtractSuccess["usage"] | undefined;
  let jobId: string | undefined;

  if (args.captionInput) {
    contexts.push(`User caption:\n${args.captionInput}`);
  }

  if (args.file) {
    const parsed = await parseTextFromUploadedFile(args.file.filepath);
    contexts.push(`OCR text from uploaded file:\n${parsed.text}`);
    usage = {
      numPages: parsed.usage?.numPages,
      credits: parsed.usage?.credits,
    };
    jobId = parsed.jobId;
  }

  const row = await runSarvamExtraction({
    category: args.category,
    context: contexts.join("\n\n"),
  });

  const captionField = fieldByHint(args.category.fields, /caption/i);

  if (captionField && args.captionInput && (!row[captionField.fieldKey] || row[captionField.fieldKey] === "Not available")) {
    row[captionField.fieldKey] = args.captionInput;
  }

  return { row, usage, jobId };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExtractSuccess | ExtractError>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  let uploadedFilePath: string | null = null;

  try {
    const { fields, file } = await parseMultipart(req);
    const categoryId = fields.category;

    if (!categoryId) {
      throw new Error("Missing category id.");
    }

    const category = await getCategoryConfigById(categoryId);

    if (!category || !category.isActive) {
      throw new Error(`Category config not found for id: ${categoryId}`);
    }

    uploadedFilePath = file?.filepath ?? null;

    const parserType = category.parserType;
    const orderedFields = sortFields(category.fields);

    let row: RowData;
    let usage: ExtractSuccess["usage"] | undefined;
    let jobId: string | null | undefined;

    if (parserType === "newspaper_pdf") {
      if (!file) {
        throw new Error("Please upload a file for this category.");
      }

      const result = await processNewspaperPdf(file, category);
      row = result.row;
      usage = result.usage;
      jobId = result.jobId;
    } else if (parserType === "photo_image") {
      if (!file) {
        throw new Error("Please upload a file for this category.");
      }

      const result = await processPhotoImage(file, category);
      row = result.row;
      usage = result.usage;
      jobId = result.jobId;
    } else if (parserType === "e_paper_link") {
      const link = fields.link ?? "";

      if (!link) {
        throw new Error("Please provide a link for this category.");
      }

      const result = await processEpaperLink(link, category);
      row = result.row;
      usage = undefined;
      jobId = undefined;
    } else if (parserType === "correspondence") {
      const textInput = fields.textInput ?? "";
      const result = await processCorrespondence({
        category,
        file,
        textInput,
      });

      row = result.row;
      usage = result.usage;
      jobId = result.jobId;
    } else if (parserType === "social_post") {
      const captionInput = fields.captionInput ?? "";
      const result = await processSocialPost({
        category,
        file,
        captionInput,
      });

      row = result.row;
      usage = result.usage;
      jobId = result.jobId;
    } else {
      throw new Error(`Unsupported parser type: ${parserType}`);
    }

    const commonFormat = renderCommonFormat(category.commonFormatTemplate, row);

    res.status(200).json({
      categoryId: category.id,
      categoryLabel: category.label,
      row,
      fields: orderedFields,
      commonFormat,
      usage,
      jobId,
      fileName: file?.originalFilename ?? null,
    });
  } catch (error: unknown) {
    if (error instanceof Reducto.APIError) {
      const statusCode = typeof error.status === "number" ? error.status : 502;
      res.status(statusCode).json({ error: `${error.name}: ${error.message}` });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown extraction error.";
    res.status(400).json({ error: message });
  } finally {
    if (uploadedFilePath) {
      await fsPromises.unlink(uploadedFilePath).catch(() => undefined);
    }
  }
}
