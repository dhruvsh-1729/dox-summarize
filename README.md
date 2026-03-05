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

## Docker (Hostinger / VPS)

### 1. Build image locally

```bash
npm run docker:build
```

### 2. Run with Docker Compose in production

```bash
docker compose -f docker-compose.prod.yml up -d
```

This expects runtime secrets in `.env` (same keys as `.env.example`).

### 3. One-command deploy pipeline (git + docker push)

```bash
npm run deploy:hostinger
```

The deploy script runs:

- `git switch main`
- `git fetch --all`
- `git merge origin/main`
- `git add .`
- `git commit -m "init"` (only when there are staged changes)
- `git push origin main`
- `sudo docker build --pull -t dhruvsh/doxsummarize:latest .`
- `sudo docker push dhruvsh/doxsummarize:latest`
- tags and pushes `dhruvsh/doxsummarize:<short_commit_sha>`

You can override defaults when needed:

```bash
IMAGE_REPO=dhruvsh/doxsummarize IMAGE_TAG=latest COMMIT_MESSAGE=init npm run deploy:hostinger
```

### 4. Simple main + local build + docker push script

```bash
npm run deploy:main-docker
```

Optional flags:

```bash
COMMIT_MESSAGE="init" IMAGE_REPO=dhruvsh/doxsummarize IMAGE_TAG=latest USE_SUDO_DOCKER=1 npm run deploy:main-docker
```

## API Endpoints

- `GET /api/category-configs` -> list active category configs
- `PUT /api/category-configs` -> update one category config
- `POST /api/extract` -> run extraction using config from Turso

## Notes

- `newspaper_pdf` uses Reducto `/extract` with JSON schema built dynamically from DB fields.
- Other parser types use Reducto OCR/parse (where needed) + Sarvam structured extraction.
- UI includes a built-in config editor section to modify prompts/fields and save back to Turso.
