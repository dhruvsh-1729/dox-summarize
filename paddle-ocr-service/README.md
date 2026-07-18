# PaddleOCR Service

A tiny self-hosted OCR microservice used by the Dynamic Media Extractor as the
default (free) OCR engine, replacing paid per-page OCR. It uses open-source
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) and runs anywhere Docker runs
(e.g. your Hostinger VPS). **Cost: just compute — $0 per page.**

## Endpoints

- `GET /health` → `{ ok, default_lang }`
- `POST /ocr` (multipart) → `{ text, numPages, engine, lang }`
  - `file`: image (png/jpg/webp/…) or PDF
  - `lang` (optional form field): overrides the default language

## Run with Docker (recommended)

```bash
cd paddle-ocr-service
docker compose up -d --build
curl http://localhost:8868/health
```

Then point the Next.js app at it:

```bash
# in the app's .env
PADDLE_OCR_URL=http://localhost:8868
# optional
PADDLE_OCR_LANG=en
```

## Run without Docker

```bash
cd paddle-ocr-service
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8868
```

## Languages

PaddleOCR loads one model per language. Set `PADDLE_OCR_LANG` (service side) or send
a `lang` form field per request. Common values: `en`, `ch`, `devanagari` (Hindi),
`gujarati`, `arabic`, `japan`, `korean`, `latin`, `cyrillic`. The first request for a
new language downloads its model (a few seconds, cached afterwards).

## Notes

- First run downloads detection/recognition/angle models (~a few hundred MB) into the
  container; they are cached for subsequent requests.
- PDFs are rendered to page images at `PADDLE_OCR_PDF_DPI` (default 200) then OCR'd
  page by page.
- Pinned to the PaddleOCR 2.x API for stability.
