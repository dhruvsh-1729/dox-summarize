# Dynamic Media Extractor

A schema-driven document/media extraction app. **Turso** is the source of truth for
categories, fields, prompts, output templates, users and roles — nothing about a
category is hardcoded. Files, links, and text are turned into structured rows by
**multiple AI models at once** (via OpenRouter) so their accuracy can be compared
side by side.

## Features

- **Fully dynamic categories** — create, edit, and delete extraction categories
  directly in the UI (label, fields, schema types, prompts, output template).
- **Multi-model extraction (OpenRouter)** — one API key unlocks Claude, GPT, Grok,
  Gemini, Llama, etc. Pick any number of models and run them concurrently; results
  are shown in a side-by-side comparison grid you can edit and export.
- **Web search augmentation** — a per-run toggle (default configurable per category)
  that enables OpenRouter's `web` plugin so models can ground answers with live search.
- **Pluggable OCR** — **Mistral OCR** by default (cheap, high accuracy) with **Reducto**
  available as a premium option. Handles PDFs and images.
- **Keyword delimiter logic** — mark any field as a *keyword field*; its values are
  normalized to a single delimiter (`/`, `,`, `-`, … configurable per category).
- **Authentication + roles** — email/password auth (scrypt + signed JWT cookie) with
  three roles:
  - `super_admin` — everything, manages all users.
  - `admin` — all categories, manages standard users.
  - `user` — only the categories granted to them; may optionally create categories.
- **Export** — copy rows (TSV) or download a full model-comparison CSV.

## Architecture

| Concern | Location |
|---|---|
| DB schema | `db/schema.sql` (+ additive migrations in stores) |
| Categories/fields store | `lib/category-config-store.ts` |
| Users/roles store | `lib/users-store.ts` |
| Auth (hash, JWT, guards) | `lib/auth.ts` |
| OpenRouter multi-model | `lib/openrouter.ts` |
| OCR engines | `lib/ocr.ts` |
| Shared extraction helpers | `lib/extraction.ts` |
| API routes | `pages/api/**` |
| UI | `pages/index.tsx`, `pages/login.tsx`, `pages/admin/users.tsx` |

## Setup

1. Install dependencies

```bash
npm install
```

2. Configure env (copy `.env.example` → `.env` and fill in)

```bash
cp .env.example .env
```

Required keys: `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `TURSO_DB_URL`, `JWT_SECRET`
(min 16 chars). Optional: `TURSO_AUTH_TOKEN`, `REDUCTO_API_KEY` (only for the Reducto
OCR option).

3. Seed categories + the first super-admin

```bash
npm run db:seed-config
```

This applies schema migrations, seeds the built-in categories, and creates a
super-admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (defaults
`admin@example.com` / `changeme123` — change these). The seed is idempotent and will
never overwrite an existing admin's password.

4. Start the app

```bash
npm run dev
```

Open `http://localhost:3000`, sign in, and provision more users from **Users**.

## API Endpoints

- `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `GET /api/category-configs` · `PUT /api/category-configs` · `DELETE /api/category-configs?id=`
- `GET /api/models` — OpenRouter model catalog (cached)
- `GET/POST /api/users` · `PUT/DELETE /api/users/[id]`
- `POST /api/extract` — OCR → text → multi-model structured extraction

All endpoints require an authenticated session cookie; category/user management is
role-gated.

## Docker (Hostinger / VPS)

```bash
npm run docker:build
docker compose -f docker-compose.prod.yml up -d   # expects runtime secrets in .env
npm run deploy:hostinger                           # git + docker build/push pipeline
```
