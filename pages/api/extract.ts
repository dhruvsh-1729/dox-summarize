import { promises as fsPromises } from "node:fs";

import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { type File, type Fields, type Files } from "formidable";

import {
  renderCommonFormat,
  sortFields,
  type CategoryConfig,
  type CategoryFieldConfig,
  type OcrEngine,
  type RowData,
} from "@/lib/category-config";
import { getCategoryConfigById } from "@/lib/category-config-store";
import { getSessionUser, userCanAccessCategory } from "@/lib/auth";
import { saveExtractionHistory } from "@/lib/extraction-history-store";
import { isPdf, parseDocument, type OcrResult } from "@/lib/ocr";
import { runModels, type ModelRunResult } from "@/lib/openrouter";

type PerModelResult = {
  model: string;
  ok: boolean;
  row?: RowData;
  commonFormat?: string;
  error?: string;
  usage?: ModelRunResult["usage"];
  latencyMs?: number;
};

type ExtractSuccess = {
  categoryId: string;
  categoryLabel: string;
  fields: CategoryFieldConfig[];
  results: PerModelResult[];
  ocr?: { engine: OcrEngine; numPages?: number; credits?: number | null; jobId?: string };
  webSearch: boolean;
  fileName?: string | null;
};

type ExtractError = { error: string };

export const config = {
  api: { bodyParser: false },
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
const DOCUMENT_CONTEXT_CHAR_LIMIT = 60000;
const NEWSPAPER_PAGE_CHAR_LIMIT = 30000;

const NEWSPAPER_PAGE_2_FIELD_KEYS = new Set([
  "author_editor",
  "title_of_article",
  "matter",
  "photo_description",
  "statement_maker_person",
  "keywords",
  "summary",
]);

const NEWSPAPER_METADATA_FIELD_KEYS = new Set(["newspaper_name", "date", "subtype_of_doc", "edition"]);

const NEWSPAPER_PDF_MODEL_RULES = [
  "Newspaper PDF source rules:",
  "The uploaded document is expected to be exactly a 2-page newspaper PDF.",
  "Use PAGE 2 ONLY for title_of_article, matter, photo_description, author_editor, statement_maker_person, keywords, and summary.",
  "Never use a PAGE 1 headline, article body, or photo caption for those PAGE 2 article fields.",
  "Use PAGE 1 only for explicit metadata such as newspaper_name, date, subtype_of_doc, and edition when PAGE 2 does not repeat it.",
  "Edition must be an explicit newspaper edition or masthead value. Do not infer edition from an article location, headline, or topic.",
  "page_numbers must refer to the target article's printed page number on PAGE 2 when visible; otherwise use \"Not available\".",
].join("\n");

/* -------------------------------------------------------------------------- */
/* Multipart parsing                                                           */
/* -------------------------------------------------------------------------- */

function toFirstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

  if (ordered.length) return ordered[0];

  const anyFile = Object.values(files)
    .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((entry): entry is File => Boolean(entry));

  return anyFile[0] ?? null;
}

async function parseMultipart(req: NextApiRequest): Promise<{ fields: Record<string, string>; file: File | null }> {
  const form = formidable({
    allowEmptyFiles: false,
    maxFiles: 1,
    maxFileSize: MAX_UPLOAD_BYTES,
    multiples: false,
    filter: ({ mimetype, originalFilename }) => {
      if (!mimetype) return true;
      if (mimetype === "application/pdf") return true;
      if (IMAGE_MIME_TYPES.has(mimetype)) return true;
      if (!originalFilename) return false;
      const lower = originalFilename.toLowerCase();
      return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
    },
  });

  const { fields, files } = await new Promise<{ fields: Fields; files: Files }>((resolve, reject) => {
    form.parse(req, (error, parsedFields, parsedFiles) => {
      if (error) reject(error);
      else resolve({ fields: parsedFields, files: parsedFiles });
    });
  });

  return { fields: normalizeFields(fields), file: pickUploadedFile(files) };
}

/* -------------------------------------------------------------------------- */
/* Link scraping (metadata + readable text)                                    */
/* -------------------------------------------------------------------------- */

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
    if (value) return value;
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

async function scrapeLink(link: string): Promise<string> {
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
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const bestBlock =
    extractHtmlTagContent(html, "article") ||
    extractHtmlTagContent(html, "main") ||
    extractHtmlTagContent(html, "body") ||
    html;

  const content = stripTagsToText(bestBlock).slice(0, 40000);

  return [
    `Input link: ${link}`,
    `Final URL: ${response.url}`,
    `Detected title: ${findMetaFromHtml(html, "og:title", "twitter:title") || collapseWhitespace(decodeHtmlEntities(titleTag)) || "Not available"}`,
    `Detected author: ${findMetaFromHtml(html, "author", "article:author", "twitter:creator") || "Not available"}`,
    `Detected date: ${findMetaFromHtml(html, "article:published_time", "og:updated_time", "date") || "Not available"}`,
    `Detected site: ${findMetaFromHtml(html, "og:site_name", "application-name") || "Not available"}`,
    `Extracted content: ${content || "Not available"}`,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function parseModelsField(raw: string, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    }
  } catch {
    // not JSON — treat as comma separated
  }
  const list = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

function parseBoolField(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw.toLowerCase() === "on";
}

function isNewspaperPdfCategory(category: CategoryConfig): boolean {
  return category.id === "newspaper_pdf" || category.parserType === "newspaper_pdf";
}

function clipText(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit)}\n[Truncated to ${limit} characters]`;
}

function getOcrPageText(ocr: OcrResult, pageNumber: number): string {
  return ocr.pages?.find((page) => page.pageNumber === pageNumber)?.text.trim() ?? "";
}

function appendPrompt(base: string, addition: string): string {
  return [base.trim(), addition.trim()].filter(Boolean).join("\n\n");
}

function applyNewspaperPdfRules(category: CategoryConfig): CategoryConfig {
  if (!isNewspaperPdfCategory(category)) {
    return category;
  }

  return {
    ...category,
    aiSystemPrompt: appendPrompt(category.aiSystemPrompt, NEWSPAPER_PDF_MODEL_RULES),
    aiTaskPrompt: appendPrompt(
      category.aiTaskPrompt,
      "Extract article fields only from PAGE 2. Use PAGE 1 only for explicit newspaper metadata, especially edition.",
    ),
    fields: category.fields.map((field) => {
      if (NEWSPAPER_PAGE_2_FIELD_KEYS.has(field.fieldKey)) {
        return {
          ...field,
          promptDescription: appendPrompt(
            field.promptDescription,
            "Source restriction: use PAGE 2 only for this field. If PAGE 2 does not contain it, use \"Not available\".",
          ),
        };
      }

      if (field.fieldKey === "edition") {
        return {
          ...field,
          promptDescription: appendPrompt(
            field.promptDescription,
            "Source restriction: capture only an explicit newspaper edition/masthead value from PAGE 1 or PAGE 2. Do not infer it.",
          ),
        };
      }

      if (field.fieldKey === "page_numbers") {
        return {
          ...field,
          promptDescription: appendPrompt(
            field.promptDescription,
            "Source restriction: use the target article's printed page number from PAGE 2 when visible.",
          ),
        };
      }

      if (NEWSPAPER_METADATA_FIELD_KEYS.has(field.fieldKey)) {
        return {
          ...field,
          promptDescription: appendPrompt(
            field.promptDescription,
            "Source restriction: use explicit newspaper metadata from PAGE 1 only when PAGE 2 does not provide this value.",
          ),
        };
      }

      return field;
    }),
  };
}

function buildNewspaperPdfContext(ocr: OcrResult, fileName?: string | null): string {
  const numPages = ocr.usage?.numPages;

  if (numPages !== undefined && numPages !== 2) {
    throw new Error(`Newspaper PDF extraction expects exactly 2 pages; OCR found ${numPages}.`);
  }

  if (!ocr.pages?.length) {
    throw new Error(
      "Newspaper PDF extraction requires page-level OCR output. Rebuild/restart the PaddleOCR service image so it returns page text.",
    );
  }

  const page1 = getOcrPageText(ocr, 1);
  const page2 = getOcrPageText(ocr, 2);

  if (!page2) {
    throw new Error("Newspaper PDF extraction requires OCR text from page 2.");
  }

  return [
    "Extracted newspaper PDF text:",
    fileName ? `Uploaded file: ${fileName}` : "",
    "PAGE 1 (METADATA ONLY - use only for explicit newspaper metadata such as newspaper name, date, subtype, and edition):",
    page1 ? clipText(page1, NEWSPAPER_PAGE_CHAR_LIMIT) : "Not available",
    "PAGE 2 (TARGET ARTICLE - use ONLY this page for title_of_article, matter, photo_description, author_editor, statement_maker_person, keywords, and summary):",
    clipText(page2, NEWSPAPER_PAGE_CHAR_LIMIT),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildDocumentContext(category: CategoryConfig, ocr: OcrResult, fileName?: string | null): string | null {
  if (isNewspaperPdfCategory(category)) {
    return buildNewspaperPdfContext(ocr, fileName);
  }

  if (!ocr.text.trim()) {
    return null;
  }

  return `Extracted document text:\n${clipText(ocr.text, DOCUMENT_CONTEXT_CHAR_LIMIT)}`;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

export default async function handler(req: NextApiRequest, res: NextApiResponse<ExtractSuccess | ExtractError>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  let uploadedFilePath: string | null = null;

  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const { fields, file } = await parseMultipart(req);
    uploadedFilePath = file?.filepath ?? null;

    const categoryId = fields.category;
    if (!categoryId) {
      throw new Error("Missing category id.");
    }

    const category = await getCategoryConfigById(categoryId);
    if (!category || !category.isActive) {
      throw new Error(`Category config not found for id: ${categoryId}`);
    }

    if (!userCanAccessCategory(user, category.id)) {
      res.status(403).json({ error: "You do not have access to this category." });
      return;
    }

    if (
      file &&
      isNewspaperPdfCategory(category) &&
      !isPdf({ filepath: file.filepath, mimetype: file.mimetype, originalFilename: file.originalFilename })
    ) {
      throw new Error("Newspaper PDF extraction requires a PDF upload.");
    }

    const models = parseModelsField(fields.models ?? "", category.defaultModels);
    if (!models.length) {
      throw new Error("Select at least one AI model, or set default models on this category.");
    }

    const webSearch = parseBoolField(fields.webSearch, category.enableWebSearch);
    const ocrEngine: OcrEngine = (fields.ocrEngine || category.defaultOcrEngine || "mistral") as OcrEngine;

    /* -------- Build source context from all provided inputs -------- */
    const contexts: string[] = [];
    let ocr: OcrResult | undefined;

    if (file) {
      ocr = await parseDocument(ocrEngine, {
        filepath: file.filepath,
        mimetype: file.mimetype,
        originalFilename: file.originalFilename,
        lang: fields.ocrLang || undefined,
      });
      const documentContext = buildDocumentContext(category, ocr, file.originalFilename);
      if (documentContext) {
        contexts.push(documentContext);
      }
    }

    if (fields.link) {
      contexts.push(await scrapeLink(fields.link));
    }

    if (fields.textInput) {
      contexts.push(`Provided text:\n${fields.textInput}`);
    }

    if (fields.captionInput) {
      contexts.push(`Caption:\n${fields.captionInput}`);
    }

    if (!contexts.length) {
      throw new Error("Provide a file, link, text, or caption to extract from.");
    }

    /* -------- Run all selected models concurrently -------- */
    const modelCategory = applyNewspaperPdfRules(category);
    const runResults = await runModels(models, {
      category: modelCategory,
      context: contexts.join("\n\n"),
      webSearch,
    });

    const results: PerModelResult[] = runResults.map((result) => ({
      model: result.model,
      ok: result.ok,
      row: result.row,
      commonFormat: result.row ? renderCommonFormat(category.commonFormatTemplate, result.row) : undefined,
      error: result.error,
      usage: result.usage,
      latencyMs: result.latencyMs,
    }));

    await saveExtractionHistory({
      category,
      userId: user.id,
      fileName: file?.originalFilename ?? null,
      models,
      webSearch,
      ocr: ocr
        ? { engine: ocr.engine, numPages: ocr.usage?.numPages, credits: ocr.usage?.credits, jobId: ocr.jobId }
        : undefined,
      results,
    });

    res.status(200).json({
      categoryId: category.id,
      categoryLabel: category.label,
      fields: sortFields(category.fields),
      results,
      ocr: ocr
        ? { engine: ocr.engine, numPages: ocr.usage?.numPages, credits: ocr.usage?.credits, jobId: ocr.jobId }
        : undefined,
      webSearch,
      fileName: file?.originalFilename ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown extraction error.";
    res.status(400).json({ error: message });
  } finally {
    if (uploadedFilePath) {
      await fsPromises.unlink(uploadedFilePath).catch(() => undefined);
    }
  }
}
