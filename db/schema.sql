CREATE TABLE IF NOT EXISTS category_configs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  parser_type TEXT NOT NULL,
  allow_file INTEGER NOT NULL DEFAULT 1,
  requires_file INTEGER NOT NULL DEFAULT 0,
  file_label TEXT NOT NULL DEFAULT '',
  file_accept TEXT NOT NULL DEFAULT '',
  link_field_label TEXT NOT NULL DEFAULT '',
  text_field_label TEXT NOT NULL DEFAULT '',
  caption_field_label TEXT NOT NULL DEFAULT '',
  ai_system_prompt TEXT NOT NULL,
  ai_task_prompt TEXT NOT NULL,
  common_format_template TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  default_ocr_engine TEXT NOT NULL DEFAULT 'paddle',
  default_models TEXT NOT NULL DEFAULT '',
  enable_web_search INTEGER NOT NULL DEFAULT 0,
  keyword_delimiter TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS category_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  schema_type TEXT NOT NULL DEFAULT 'string',
  item_schema_type TEXT,
  prompt_description TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_keyword INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES category_configs(id) ON DELETE CASCADE,
  UNIQUE (category_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_category_fields_category_order
ON category_fields(category_id, display_order, id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  can_create_categories INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_category_access (
  user_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE IF NOT EXISTS extraction_runs (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  category_label TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  file_name TEXT,
  models TEXT NOT NULL DEFAULT '',
  web_search INTEGER NOT NULL DEFAULT 0,
  ocr_engine TEXT,
  ocr_pages INTEGER,
  ocr_credits REAL,
  ocr_job_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_category_created
ON extraction_runs(category_id, created_at DESC);

CREATE TABLE IF NOT EXISTS extraction_model_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  model TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  row_json TEXT NOT NULL DEFAULT '',
  common_format TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  usage_json TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES extraction_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_extraction_model_outputs_run
ON extraction_model_outputs(run_id, id);

CREATE TABLE IF NOT EXISTS extraction_field_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_label TEXT NOT NULL DEFAULT '',
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  normalized_value TEXT NOT NULL DEFAULT '',
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES extraction_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_extraction_field_values_category_field_created
ON extraction_field_values(category_id, field_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extraction_field_values_suggestions
ON extraction_field_values(category_id, field_key, is_available, normalized_value);
