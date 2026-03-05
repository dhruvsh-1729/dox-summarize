# Dynamic Media Extractor (Turso + Reducto + Sarvam)

This app now uses **Turso** as the source of truth for:

- category definitions
- field names
- schema types
- per-field prompt descriptions
- system/task prompts
- common output template

No extraction category is hardcoded in the UI/API flow.

## What Is Dynamic

For each category you can edit and save:

- `label`, `description`, `parserType`
- file/link/text/caption input labels
- `aiSystemPrompt`, `aiTaskPrompt`
- `commonFormatTemplate` (supports placeholders like `{{matter}}`)
- field list with:
  - `fieldKey`
  - `fieldLabel`
  - `schemaType` (`string|number|boolean|array`)
  - `itemSchemaType` for arrays
  - `promptDescription`
  - `required`

All of the above is persisted in Turso.

## Database Files

- Schema: `db/schema.sql`
- Seeder: `scripts/seed-turso.mjs`

## Setup

1. Install dependencies

```bash
npm install
```

2. Configure env

```bash
cp .env.example .env.local
```

Set values in `.env.local`:

```bash
REDUCTO_API_KEY=...
REDUCTO_ENVIRONMENT=production
SARVAM_API_KEY=...
SARVAM_MODEL=sarvam-m
TURSO_DB_URL=...
TURSO_AUTH_TOKEN=... # optional
```

3. Create/seed Turso config data (from previous hardcoded defaults)

```bash
npm run db:seed-config
```

4. Start app

```bash
npm run dev
```

Open `http://localhost:3000`.

## API Endpoints

- `GET /api/category-configs` -> list active category configs
- `PUT /api/category-configs` -> update one category config
- `POST /api/extract` -> run extraction using config from Turso

## Notes

- `newspaper_pdf` uses Reducto `/extract` with JSON schema built dynamically from DB fields.
- Other parser types use Reducto OCR/parse (where needed) + Sarvam structured extraction.
- UI includes a built-in config editor section to modify prompts/fields and save back to Turso.
