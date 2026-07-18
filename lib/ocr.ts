import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

import Reducto from "reductoai";

import { type OcrEngine } from "@/lib/category-config";

export type OcrResult = {
  text: string;
  engine: OcrEngine;
  usage?: {
    numPages?: number;
    credits?: number | null;
  };
  jobId?: string;
};

export type OcrInput = {
  filepath: string;
  mimetype?: string | null;
  originalFilename?: string | null;
  /** PaddleOCR language code (e.g. "en", "hi", "sa"). Falls back to PADDLE_OCR_LANG. */
  lang?: string | null;
};

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff", ".bmp"];

export function isPdf(input: OcrInput): boolean {
  if (input.mimetype === "application/pdf") return true;
  return (input.originalFilename ?? "").toLowerCase().endsWith(".pdf");
}

export function isImage(input: OcrInput): boolean {
  if (input.mimetype && input.mimetype.startsWith("image/")) return true;
  const lower = (input.originalFilename ?? "").toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function guessMime(input: OcrInput): string {
  if (input.mimetype) return input.mimetype;
  if (isPdf(input)) return "application/pdf";
  const lower = (input.originalFilename ?? "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/* -------------------------------------------------------------------------- */
/* PaddleOCR (default — open-source, self-hosted, zero per-page cost)          */
/* -------------------------------------------------------------------------- */

// Calls the self-hosted PaddleOCR service (see paddle-ocr-service/). The service
// accepts a multipart file upload and returns extracted text. PDFs are rendered
// to page images and OCR'd page by page inside the service.
async function runPaddleOcr(input: OcrInput): Promise<OcrResult> {
  const baseUrl = process.env.PADDLE_OCR_URL;
  if (!baseUrl) {
    throw new Error(
      "Missing PADDLE_OCR_URL. Start the PaddleOCR service (see paddle-ocr-service/) and set PADDLE_OCR_URL.",
    );
  }

  const buffer = await fsPromises.readFile(input.filepath);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: guessMime(input) });
  form.append("file", blob, input.originalFilename ?? "upload");
  const lang = (input.lang || process.env.PADDLE_OCR_LANG || "").trim();
  if (lang) {
    form.append("lang", lang);
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ocr`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const failureText = await response.text();
    throw new Error(`PaddleOCR error (${response.status}): ${failureText.slice(0, 400)}`);
  }

  const payload = (await response.json()) as { text?: string; numPages?: number };

  return {
    text: (payload.text ?? "").trim(),
    engine: "paddle",
    usage: { numPages: payload.numPages },
  };
}

/* -------------------------------------------------------------------------- */
/* Reducto (premium option)                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_PARSE_OPTIONS: Omit<Reducto.ParseRunParams.SyncParseConfig, "input"> = {
  enhance: { agentic: [{ scope: "text" }], summarize_figures: true },
  formatting: { table_output_format: "md" },
  settings: { ocr_system: "standard" },
};

export function getReductoClient(): Reducto {
  const apiKey = process.env.REDUCTO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing REDUCTO_API_KEY in server environment.");
  }

  const environment = process.env.REDUCTO_ENVIRONMENT;
  const runtimeEnvironment =
    environment === "production" || environment === "eu" || environment === "au" ? environment : undefined;

  return new Reducto({
    apiKey,
    ...(runtimeEnvironment ? { environment: runtimeEnvironment } : {}),
    maxRetries: 2,
    timeout: 5 * 60 * 1000,
  });
}

async function runReductoParse(input: OcrInput): Promise<OcrResult> {
  const client = getReductoClient();
  const upload = await client.upload({ file: fs.createReadStream(input.filepath) });
  const parseResponse = await client.parse.run({ input: upload, ...DEFAULT_PARSE_OPTIONS });

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
    const remoteJson = (await remote.json()) as { chunks?: Array<{ content?: string }> };
    text = (remoteJson.chunks ?? []).map((chunk) => chunk.content ?? "").join("\n\n");
  }

  return {
    text,
    engine: "reducto",
    usage: { numPages: parseResponse.usage.num_pages, credits: parseResponse.usage.credits },
    jobId: parseResponse.job_id,
  };
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

export async function parseDocument(engine: OcrEngine, input: OcrInput): Promise<OcrResult> {
  if (engine === "reducto") {
    return runReductoParse(input);
  }
  // Default to PaddleOCR for everything else (legacy "mistral" values fall through here).
  return runPaddleOcr(input);
}
