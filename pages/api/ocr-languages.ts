import type { NextApiRequest, NextApiResponse } from "next";

import { getSessionUser } from "@/lib/auth";

type OcrLanguage = { code: string; label: string };
type Response = { languages: OcrLanguage[]; default: string; source: "service" | "fallback" } | { error: string };

// Used when the PaddleOCR service is unreachable at request time.
const FALLBACK_LANGUAGES: OcrLanguage[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "sa", label: "Sanskrit" },
  { code: "mr", label: "Marathi" },
  { code: "ne", label: "Nepali" },
  { code: "devanagari", label: "Devanagari (generic)" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "ka", label: "Kannada" },
  { code: "ar", label: "Arabic" },
  { code: "ur", label: "Urdu" },
  { code: "fa", label: "Persian" },
  { code: "ru", label: "Russian" },
  { code: "ch", label: "Chinese (Simplified)" },
  { code: "chinese_cht", label: "Chinese (Traditional)" },
  { code: "japan", label: "Japanese" },
  { code: "korean", label: "Korean" },
  { code: "latin", label: "Latin (multi-language)" },
  { code: "cyrillic", label: "Cyrillic (multi-language)" },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const baseUrl = process.env.PADDLE_OCR_URL;
  const fallbackDefault = process.env.PADDLE_OCR_LANG || "en";

  if (baseUrl) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/languages`, {
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) {
        const payload = (await response.json()) as { languages?: OcrLanguage[]; default?: string };
        if (Array.isArray(payload.languages) && payload.languages.length) {
          res.status(200).json({
            languages: payload.languages,
            default: payload.default || fallbackDefault,
            source: "service",
          });
          return;
        }
      }
    } catch {
      // Service down or slow — fall back to the static list below.
    }
  }

  res.status(200).json({ languages: FALLBACK_LANGUAGES, default: fallbackDefault, source: "fallback" });
}
