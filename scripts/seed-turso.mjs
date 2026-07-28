import "dotenv/config";

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@libsql/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TURSO_DB_URL = process.env.TURSO_DB_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DB_URL) {
  throw new Error("Missing TURSO_DB_URL. Add it in .env or export it before running the script.");
}

const client = createClient({
  url: TURSO_DB_URL,
  ...(TURSO_AUTH_TOKEN ? { authToken: TURSO_AUTH_TOKEN } : {}),
});

const categories = [
  {
    id: "newspaper_pdf",
    label: "Newspaper PDF",
    description: "2-page newspaper PDF (page 1 metadata, page 2 target article).",
    parserType: "newspaper_pdf",
    allowFile: true,
    requiresFile: true,
    fileLabel: "Upload newspaper PDF (2 pages)",
    fileAccept: "application/pdf,.pdf",
    linkFieldLabel: "",
    textFieldLabel: "",
    captionFieldLabel: "",
    aiSystemPrompt:
      "You are given a 2-page newspaper article PDF. Page 1 has newspaper metadata and page 2 has the target article. Source can be English, Hindi, or Gujarati. Return output in English while preserving original names. Use page 2 only for article title, matter, photo description, author/editor, statement maker, keywords, and summary. Use page 1 only for explicit metadata such as newspaper name, date, subtype, and edition when page 2 does not repeat it. Keywords must be proper nouns, ideally in the pattern: Person/Org (Designation, Location).",
    aiTaskPrompt:
      "Extract all configured fields from the document. Article fields must come only from page 2; do not use any page 1 headline, article text, or photo caption for them. Capture the edition only when it is explicitly printed in the newspaper metadata or masthead; do not infer it. For keywords, keep only proper nouns with role/designation/location when available from page 2.",
    commonFormatTemplate:
      "Matter - {{subtype_of_doc}} by {{newspaper_name}} titled {{title_of_article}} dated {{date}}",
    fields: [
      {
        fieldKey: "newspaper_name",
        fieldLabel: "Newspaper name",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Newspaper name from explicit page 1 metadata or page 2 if repeated.",
        required: true,
      },
      {
        fieldKey: "date",
        fieldLabel: "Date",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Publication date from explicit page 1 metadata or page 2 if repeated.",
        required: true,
      },
      {
        fieldKey: "language",
        fieldLabel: "Language",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Language used in the page 2 target article.",
        required: true,
      },
      {
        fieldKey: "subtype_of_doc",
        fieldLabel: "Subtype of doc",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Subtype such as newspaper, e-newspaper, article, blog, etc. from explicit newspaper metadata.",
        required: true,
      },
      {
        fieldKey: "edition",
        fieldLabel: "Edition",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription:
          "Edition value only when explicitly printed in the page 1 metadata/masthead or page 2. Do not infer from locations or headlines.",
        required: true,
      },
      {
        fieldKey: "page_numbers",
        fieldLabel: "Page numbers",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Target article page number reference visible on page 2.",
        required: true,
      },
      {
        fieldKey: "author_editor",
        fieldLabel: "Author/Editor",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Name of article author/editor from page 2 only.",
        required: true,
      },
      {
        fieldKey: "title_of_article",
        fieldLabel: "Title of Article",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Article title/headline from page 2 only. Ignore page 1 headlines.",
        required: true,
      },
      {
        fieldKey: "matter",
        fieldLabel: "Matter",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Main article text from page 2 only in English.",
        required: true,
      },
      {
        fieldKey: "photo_description",
        fieldLabel: "Photo Description",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Short description of image/visual present with the page 2 target article only.",
        required: true,
      },
      {
        fieldKey: "statement_maker_person",
        fieldLabel: "Statement maker person",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Individual/organization making a notable statement in the page 2 target article only.",
        required: true,
      },
      {
        fieldKey: "keywords",
        fieldLabel: "Keywords",
        schemaType: "array",
        itemSchemaType: "string",
        promptDescription:
          "Proper noun tags from page 2 only. Include person/organization plus designation and location if available.",
        required: true,
      },
      {
        fieldKey: "summary",
        fieldLabel: "Summary",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Short summary of the page 2 target article matter only.",
        required: true,
      },
    ],
  },
  {
    id: "photo_image",
    label: "Photo / Image",
    description: "Uploaded image/photo with OCR + semantic extraction.",
    parserType: "photo_image",
    allowFile: true,
    requiresFile: true,
    fileLabel: "Upload image/photo (or PDF)",
    fileAccept: "image/*,application/pdf,.pdf",
    linkFieldLabel: "",
    textFieldLabel: "",
    captionFieldLabel: "",
    aiSystemPrompt:
      "Extract structured information from image/OCR content and return JSON only in English while preserving names.",
    aiTaskPrompt:
      "Extract configured fields from uploaded image/photo content. Matter should capture key claim/topic. Description should summarize what is visible.",
    commonFormatTemplate: "Matter - Photo/visual item by {{by}} dated {{date}} about {{matter}}",
    fields: [
      {
        fieldKey: "by",
        fieldLabel: "By",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Author, creator, or source name if inferable.",
        required: true,
      },
      {
        fieldKey: "matter",
        fieldLabel: "Matter",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Central topic/claim from OCR + visual context.",
        required: true,
      },
      {
        fieldKey: "date",
        fieldLabel: "Date",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Date visible or inferable from content.",
        required: true,
      },
      {
        fieldKey: "keywords",
        fieldLabel: "Keywords",
        schemaType: "array",
        itemSchemaType: "string",
        promptDescription:
          "Proper noun tags only (person/org/designation/location when available).",
        required: true,
      },
      {
        fieldKey: "description",
        fieldLabel: "Description",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Short visual description.",
        required: true,
      },
    ],
  },
  {
    id: "e_paper_link",
    label: "E-Paper Link",
    description: "Scrape an E-paper/article URL and extract structured data.",
    parserType: "e_paper_link",
    allowFile: false,
    requiresFile: false,
    fileLabel: "No file required",
    fileAccept: "",
    linkFieldLabel: "E-paper link",
    textFieldLabel: "",
    captionFieldLabel: "",
    aiSystemPrompt:
      "Extract structured information from scraped article text and return strict JSON only.",
    aiTaskPrompt:
      "Extract configured E-paper fields from scraped URL content.",
    commonFormatTemplate: "Matter - E-paper by {{newspaper_name}} titled {{title}} dated {{date}}",
    fields: [
      {
        fieldKey: "content_for_link",
        fieldLabel: "Content for link",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Useful extracted article content from the provided link.",
        required: true,
      },
      {
        fieldKey: "newspaper_name",
        fieldLabel: "Newspaper name",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Newspaper/site name.",
        required: true,
      },
      {
        fieldKey: "edition",
        fieldLabel: "Edition",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Edition if present.",
        required: true,
      },
      {
        fieldKey: "date",
        fieldLabel: "Date",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Publish date.",
        required: true,
      },
      {
        fieldKey: "language",
        fieldLabel: "Language",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Language of article.",
        required: true,
      },
      {
        fieldKey: "author",
        fieldLabel: "Author",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Author/byline.",
        required: true,
      },
      {
        fieldKey: "title",
        fieldLabel: "Title",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Article headline/title.",
        required: true,
      },
      {
        fieldKey: "matter",
        fieldLabel: "Matter",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Main matter/body summary.",
        required: true,
      },
    ],
  },
  {
    id: "correspondence",
    label: "Correspondence",
    description: "Letter/email style content from file upload or pasted text.",
    parserType: "correspondence",
    allowFile: true,
    requiresFile: false,
    fileLabel: "Optional file upload (PDF/image)",
    fileAccept: "image/*,application/pdf,.pdf",
    linkFieldLabel: "",
    textFieldLabel: "Correspondence text",
    captionFieldLabel: "",
    aiSystemPrompt:
      "Extract structured correspondence details from letters/emails/official communication.",
    aiTaskPrompt:
      "Extract configured correspondence fields from provided document text.",
    commonFormatTemplate:
      "Matter - Correspondence from {{from}} to {{to}} regarding {{regarding}} dated {{date}}",
    fields: [
      {
        fieldKey: "matter",
        fieldLabel: "Matter",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Main correspondence content.",
        required: true,
      },
      {
        fieldKey: "to",
        fieldLabel: "To",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Recipient.",
        required: true,
      },
      {
        fieldKey: "from",
        fieldLabel: "From",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Sender.",
        required: true,
      },
      {
        fieldKey: "date",
        fieldLabel: "Date",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Date of correspondence.",
        required: true,
      },
      {
        fieldKey: "regarding",
        fieldLabel: "Regarding",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Subject/regarding field.",
        required: true,
      },
      {
        fieldKey: "summary",
        fieldLabel: "Summary",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Short summary.",
        required: true,
      },
      {
        fieldKey: "language",
        fieldLabel: "Language",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Detected language.",
        required: true,
      },
    ],
  },
  {
    id: "social_post",
    label: "Social Media Post",
    description: "Caption + screenshot/image of a social post.",
    parserType: "social_post",
    allowFile: true,
    requiresFile: false,
    fileLabel: "Optional social post screenshot (image/PDF)",
    fileAccept: "image/*,application/pdf,.pdf",
    linkFieldLabel: "",
    textFieldLabel: "",
    captionFieldLabel: "Social caption text",
    aiSystemPrompt:
      "Extract social media post details from caption and visual OCR context. Return JSON only.",
    aiTaskPrompt:
      "Extract configured social post fields. Infer platform/author if possible.",
    commonFormatTemplate: "Matter - {{platform}} post by {{by}} dated {{date}}",
    fields: [
      {
        fieldKey: "date",
        fieldLabel: "Date",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Post date.",
        required: true,
      },
      {
        fieldKey: "platform",
        fieldLabel: "Platform",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Platform name (X, Instagram, Facebook, etc.).",
        required: true,
      },
      {
        fieldKey: "caption",
        fieldLabel: "Caption",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Post caption text.",
        required: true,
      },
      {
        fieldKey: "language",
        fieldLabel: "Language",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Detected language.",
        required: true,
      },
      {
        fieldKey: "by",
        fieldLabel: "By",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Post author/account owner.",
        required: true,
      },
      {
        fieldKey: "description",
        fieldLabel: "Description",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Visual/content description.",
        required: true,
      },
    ],
  },
];

function splitSqlStatements(rawSql) {
  return rawSql
    .replace(/--.*$/gm, "")
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

// Additive migrations so an existing (pre-upgrade) Turso DB gains the new columns.
const MIGRATIONS = [
  `ALTER TABLE category_configs ADD COLUMN default_ocr_engine TEXT NOT NULL DEFAULT 'paddle'`,
  `ALTER TABLE category_configs ADD COLUMN default_models TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE category_configs ADD COLUMN enable_web_search INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE category_configs ADD COLUMN keyword_delimiter TEXT NOT NULL DEFAULT '/'`,
  `ALTER TABLE category_fields ADD COLUMN is_keyword INTEGER NOT NULL DEFAULT 0`,
];

async function applySchema() {
  const schemaPath = path.resolve(__dirname, "../db/schema.sql");
  const schemaRaw = await readFile(schemaPath, "utf8");
  const statements = splitSqlStatements(schemaRaw).map((sql) => ({ sql }));

  if (statements.length) {
    await client.batch(statements, "write");
  }

  for (const sql of MIGRATIONS) {
    try {
      await client.execute(sql);
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  // Move any categories still pointing at the removed Mistral engine to PaddleOCR.
  try {
    await client.execute(`UPDATE category_configs SET default_ocr_engine = 'paddle' WHERE default_ocr_engine = 'mistral'`);
  } catch {
    // Column may not exist yet on a brand-new DB — safe to ignore.
  }
}

// Mirrors lib/auth.ts hashPassword (scrypt) so seeded users can log in.
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function seedSuperAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "changeme123";
  const name = process.env.SEED_ADMIN_NAME ?? "Super Admin";

  const existing = await client.execute({
    sql: `SELECT id FROM users WHERE email = ? LIMIT 1`,
    args: [email],
  });

  if (existing.rows.length) {
    console.log(`Super admin already exists (${email}) — leaving password unchanged.`);
    return;
  }

  const id = `usr_${crypto.randomBytes(6).toString("hex")}`;
  await client.execute({
    sql: `INSERT INTO users (id, email, name, password_hash, role, can_create_categories, is_active)
          VALUES (?, ?, ?, ?, 'super_admin', 1, 1)`,
    args: [id, email, name, hashPassword(password)],
  });

  console.log(`Seeded super admin: ${email} (password: ${password})`);
  console.log("  → Change this password after first login, or set SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD before seeding.");
}

async function upsertCategory(category) {
  const statements = [
    {
      sql: `INSERT INTO category_configs (
              id, label, description, parser_type, allow_file, requires_file, file_label, file_accept,
              link_field_label, text_field_label, caption_field_label, ai_system_prompt, ai_task_prompt,
              common_format_template, is_active, default_ocr_engine, default_models, enable_web_search,
              keyword_delimiter, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              label = excluded.label,
              description = excluded.description,
              parser_type = excluded.parser_type,
              allow_file = excluded.allow_file,
              requires_file = excluded.requires_file,
              file_label = excluded.file_label,
              file_accept = excluded.file_accept,
              link_field_label = excluded.link_field_label,
              text_field_label = excluded.text_field_label,
              caption_field_label = excluded.caption_field_label,
              ai_system_prompt = excluded.ai_system_prompt,
              ai_task_prompt = excluded.ai_task_prompt,
              common_format_template = excluded.common_format_template,
              is_active = 1,
              default_ocr_engine = excluded.default_ocr_engine,
              default_models = excluded.default_models,
              enable_web_search = excluded.enable_web_search,
              keyword_delimiter = excluded.keyword_delimiter,
              updated_at = CURRENT_TIMESTAMP`,
      args: [
        category.id,
        category.label,
        category.description,
        category.parserType,
        category.allowFile ? 1 : 0,
        category.requiresFile ? 1 : 0,
        category.fileLabel,
        category.fileAccept,
        category.linkFieldLabel,
        category.textFieldLabel,
        category.captionFieldLabel,
        category.aiSystemPrompt,
        category.aiTaskPrompt,
        category.commonFormatTemplate,
        category.defaultOcrEngine ?? "paddle",
        Array.isArray(category.defaultModels) ? category.defaultModels.join(",") : (category.defaultModels ?? ""),
        category.enableWebSearch ? 1 : 0,
        category.keywordDelimiter ?? "/",
      ],
    },
    {
      sql: `DELETE FROM category_fields WHERE category_id = ?`,
      args: [category.id],
    },
  ];

  for (let index = 0; index < category.fields.length; index += 1) {
    const field = category.fields[index];

    statements.push({
      sql: `INSERT INTO category_fields (
              category_id, field_key, field_label, schema_type, item_schema_type,
              prompt_description, required, display_order, is_keyword, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [
        category.id,
        field.fieldKey,
        field.fieldLabel,
        field.schemaType,
        field.itemSchemaType,
        field.promptDescription,
        field.required ? 1 : 0,
        index,
        field.isKeyword || /keyword/i.test(field.fieldKey) || /keyword/i.test(field.fieldLabel) ? 1 : 0,
      ],
    });
  }

  await client.batch(statements, "write");
}

async function main() {
  await applySchema();

  for (const category of categories) {
    await upsertCategory(category);
  }

  console.log(`Seeded ${categories.length} category configs into Turso.`);

  await seedSuperAdmin();
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
