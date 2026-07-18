"""Minimal PaddleOCR HTTP service.

Accepts a multipart file upload (image or PDF) and returns extracted text.
PDFs are rendered to page images with PyMuPDF and OCR'd page by page.

Run locally:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8868

The Next.js app calls this via PADDLE_OCR_URL (e.g. http://localhost:8868).
"""

import io
import os

import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from PIL import Image

import fitz  # PyMuPDF
from paddleocr import PaddleOCR

app = FastAPI(title="PaddleOCR Service")

# One PaddleOCR engine per language, created lazily and cached.
_engines: dict[str, PaddleOCR] = {}
DEFAULT_LANG = os.environ.get("PADDLE_OCR_LANG", "en")
PDF_DPI = int(os.environ.get("PADDLE_OCR_PDF_DPI", "200"))

# Languages supported by PaddleOCR's recognition models (curated, Indic-focused).
# NOTE: PaddleOCR does not currently ship a Gujarati model.
SUPPORTED_LANGS = [
    {"code": "en", "label": "English"},
    {"code": "hi", "label": "Hindi"},
    {"code": "sa", "label": "Sanskrit"},
    {"code": "mr", "label": "Marathi"},
    {"code": "ne", "label": "Nepali"},
    {"code": "devanagari", "label": "Devanagari (generic)"},
    {"code": "ta", "label": "Tamil"},
    {"code": "te", "label": "Telugu"},
    {"code": "ka", "label": "Kannada"},
    {"code": "ar", "label": "Arabic"},
    {"code": "ur", "label": "Urdu"},
    {"code": "fa", "label": "Persian"},
    {"code": "ru", "label": "Russian"},
    {"code": "ch", "label": "Chinese (Simplified)"},
    {"code": "chinese_cht", "label": "Chinese (Traditional)"},
    {"code": "japan", "label": "Japanese"},
    {"code": "korean", "label": "Korean"},
    {"code": "latin", "label": "Latin (multi-language)"},
    {"code": "cyrillic", "label": "Cyrillic (multi-language)"},
]


def get_engine(lang: str) -> PaddleOCR:
    if lang not in _engines:
        _engines[lang] = PaddleOCR(use_angle_cls=True, lang=lang, show_log=False)
    return _engines[lang]


def ocr_image_bytes(img_bytes: bytes, lang: str) -> str:
    image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    array = np.array(image)
    result = get_engine(lang).ocr(array, cls=True)

    lines: list[str] = []
    for page in result or []:
        if not page:
            continue
        for line in page:
            # line = [box, (text, confidence)]
            try:
                text = line[1][0]
            except (IndexError, TypeError):
                text = ""
            if text:
                lines.append(text)
    return "\n".join(lines)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "default_lang": DEFAULT_LANG}


@app.get("/languages")
def languages() -> dict:
    return {"default": DEFAULT_LANG, "languages": SUPPORTED_LANGS}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...), lang: str | None = Form(None)) -> dict:
    lang = lang or DEFAULT_LANG
    data = await file.read()
    name = (file.filename or "").lower()
    is_pdf = file.content_type == "application/pdf" or name.endswith(".pdf")

    pages_text: list[str] = []

    if is_pdf:
        doc = fitz.open(stream=data, filetype="pdf")
        num_pages = doc.page_count
        for page in doc:
            pixmap = page.get_pixmap(dpi=PDF_DPI)
            pages_text.append(ocr_image_bytes(pixmap.tobytes("png"), lang))
        doc.close()
    else:
        num_pages = 1
        pages_text.append(ocr_image_bytes(data, lang))

    return {
        "text": "\n\n".join(t for t in pages_text if t).strip(),
        "numPages": num_pages,
        "engine": "paddle",
        "lang": lang,
    }
