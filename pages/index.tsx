import Head from "next/head";
import { useRouter } from "next/router";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import AppNav from "@/components/AppNav";
import {
  DEFAULT_KEYWORD_DELIMITER,
  normalizeKeywordDelimiter,
  renderCommonFormat,
  sortFields,
  type ArrayItemSchemaType,
  type CategoryConfig,
  type CategoryFieldConfig,
  type FieldSchemaType,
  type OcrEngine,
  type RowData,
} from "@/lib/category-config";
import type { SessionUser } from "@/lib/auth";

/* ------------------------------- Client types ------------------------------ */

type ModelInfo = {
  id: string;
  name: string;
  contextLength?: number;
  promptPrice?: string;
  completionPrice?: string;
};

type OcrLanguage = { code: string; label: string };

type PerModelResult = {
  model: string;
  ok: boolean;
  row?: RowData;
  commonFormat?: string;
  error?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number | null };
  latencyMs?: number;
};

type ExtractResponse = {
  categoryId: string;
  categoryLabel: string;
  fields: CategoryFieldConfig[];
  results: PerModelResult[];
  ocr?: { engine: OcrEngine; numPages?: number; credits?: number | null };
  webSearch: boolean;
  fileName?: string | null;
};

type RunState = {
  fileName: string;
  fields: CategoryFieldConfig[];
  results: PerModelResult[];
  webSearch: boolean;
  ocr?: ExtractResponse["ocr"];
};

const PARSER_TYPE_OPTIONS = ["newspaper_pdf", "photo_image", "e_paper_link", "correspondence", "social_post"];
const FIELD_SCHEMA_OPTIONS: FieldSchemaType[] = ["string", "number", "boolean", "array"];
const ARRAY_ITEM_OPTIONS = ["string", "number", "boolean", "object"] as const;
const OCR_ENGINE_OPTIONS: { value: OcrEngine; label: string }[] = [
  { value: "paddle", label: "PaddleOCR (free, self-hosted)" },
  { value: "reducto", label: "Reducto (premium)" },
];

// Handy starting points if the OpenRouter catalog can't be loaded.
const SUGGESTED_MODELS = [
  "anthropic/claude-sonnet-4",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash-001",
  "x-ai/grok-2-1212",
  "meta-llama/llama-3.3-70b-instruct",
];

function cloneConfig(config: CategoryConfig): CategoryConfig {
  return { ...config, defaultModels: [...config.defaultModels], fields: config.fields.map((f) => ({ ...f })) };
}

function blankCategory(id: string): CategoryConfig {
  return {
    id,
    label: "New Category",
    description: "Describe what this category extracts.",
    parserType: "correspondence",
    allowFile: true,
    requiresFile: false,
    fileLabel: "Upload file (PDF or image)",
    fileAccept: "application/pdf,image/*",
    linkFieldLabel: "",
    textFieldLabel: "Paste text",
    captionFieldLabel: "",
    aiSystemPrompt: "You extract structured information and return strict JSON only.",
    aiTaskPrompt: "Extract the configured fields from the provided source.",
    commonFormatTemplate: "",
    isActive: true,
    defaultOcrEngine: "paddle",
    defaultModels: [],
    enableWebSearch: false,
    keywordDelimiter: DEFAULT_KEYWORD_DELIMITER,
    fields: [
      {
        fieldKey: "title",
        fieldLabel: "Title",
        schemaType: "string",
        itemSchemaType: null,
        promptDescription: "Main title or heading.",
        required: true,
        displayOrder: 0,
        isKeyword: false,
      },
    ],
  };
}

function sanitize(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\t/g, " ").trim();
}

function escapeCsv(value: string): string {
  return `"${sanitize(value).replaceAll('"', '""')}"`;
}

/* --------------------------------- Page ----------------------------------- */

export default function Home() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [me, setMe] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [configs, setConfigs] = useState<CategoryConfig[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");

  const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([]);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  const [linkInput, setLinkInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [captionInput, setCaptionInput] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>("paddle");
  const [ocrLanguages, setOcrLanguages] = useState<OcrLanguage[]>([]);
  const [ocrLang, setOcrLang] = useState("en");
  const [customLang, setCustomLang] = useState("");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [run, setRun] = useState<RunState | null>(null);
  const [editedRows, setEditedRows] = useState<Record<string, RowData>>({});

  const [configDraft, setConfigDraft] = useState<CategoryConfig | null>(null);
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const selectedConfig = useMemo(() => configs.find((c) => c.id === categoryId) ?? null, [configs, categoryId]);
  const fields = useMemo(() => sortFields(selectedConfig?.fields ?? []), [selectedConfig]);

  /* ----- Auth gate ----- */
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const payload = (await response.json()) as { user: SessionUser };
        if (active) setMe(payload.user);
      })
      .catch(() => router.replace("/login"))
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, [router]);

  /* ----- Load configs + models once authed ----- */
  const loadConfigs = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const response = await fetch("/api/category-configs");
      const payload = (await response.json()) as { categories?: CategoryConfig[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load categories.");
      const list = payload.categories ?? [];
      setConfigs(list);
      setCategoryId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? ""));
      if (!list.length) setConfigError("No categories available for your account yet.");
    } catch (loadError: unknown) {
      setConfigError(loadError instanceof Error ? loadError.message : "Could not load categories.");
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    void loadConfigs();

    fetch("/api/models")
      .then(async (response) => {
        const payload = (await response.json()) as { models?: ModelInfo[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Model catalog unavailable.");
        setModelCatalog(payload.models ?? []);
      })
      .catch((catalogError: unknown) => {
        setModelCatalogError(catalogError instanceof Error ? catalogError.message : "Model catalog unavailable.");
      });

    fetch("/api/ocr-languages")
      .then(async (response) => {
        const payload = (await response.json()) as { languages?: OcrLanguage[]; default?: string };
        if (response.ok && payload.languages?.length) {
          setOcrLanguages(payload.languages);
          setOcrLang((prev) => (payload.languages?.some((l) => l.code === prev) ? prev : payload.default ?? "en"));
        }
      })
      .catch(() => undefined);
  }, [me, loadConfigs]);

  /* ----- Sync per-category defaults when category changes ----- */
  useEffect(() => {
    if (!selectedConfig) {
      setConfigDraft(null);
      return;
    }
    setSelectedModels(selectedConfig.defaultModels.length ? selectedConfig.defaultModels : SUGGESTED_MODELS.slice(0, 2));
    setWebSearch(selectedConfig.enableWebSearch);
    setOcrEngine(selectedConfig.defaultOcrEngine || "paddle");
    if (!isNewCategory) {
      setConfigDraft(cloneConfig(selectedConfig));
    }
    setRun(null);
    setEditedRows({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConfig]);

  const canManageCurrent = useMemo(() => {
    if (!me) return false;
    if (me.role === "super_admin" || me.role === "admin") return true;
    return me.canCreateCategories && selectedConfig ? me.categoryAccess.includes(selectedConfig.id) : false;
  }, [me, selectedConfig]);

  /* ----- Model selection helpers ----- */
  const toggleModel = (id: string) => {
    setSelectedModels((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  };

  const filteredCatalog = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    const source = modelCatalog.length
      ? modelCatalog
      : SUGGESTED_MODELS.map((id) => ({ id, name: id }) as ModelInfo);
    if (!query) return source.slice(0, 40);
    return source.filter((m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)).slice(0, 40);
  }, [modelCatalog, modelQuery]);

  /* ----- Run extraction ----- */
  const onExtract = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedConfig) return;
    setError(null);
    setNote(null);

    if (!selectedModels.length) {
      setError("Select at least one AI model to run.");
      return;
    }

    const file = fileInputRef.current?.files?.[0] ?? null;
    if (selectedConfig.requiresFile && !file) {
      setError("Please upload a file for this category.");
      return;
    }

    const formData = new FormData();
    formData.append("category", selectedConfig.id);
    formData.append("models", JSON.stringify(selectedModels));
    formData.append("webSearch", webSearch ? "true" : "false");
    formData.append("ocrEngine", ocrEngine);
    if (ocrEngine === "paddle") {
      formData.append("ocrLang", (customLang.trim() || ocrLang).toLowerCase());
    }
    if (file) formData.append("file", file);
    if (linkInput.trim()) formData.append("link", linkInput.trim());
    if (textInput.trim()) formData.append("textInput", textInput.trim());
    if (captionInput.trim()) formData.append("captionInput", captionInput.trim());

    setRunning(true);
    try {
      const response = await fetch("/api/extract", { method: "POST", body: formData });
      const payload = (await response.json()) as ExtractResponse | { error: string };
      if (!response.ok) throw new Error("error" in payload ? payload.error : "Extraction failed.");

      const success = payload as ExtractResponse;
      setRun({
        fileName: success.fileName || file?.name || "input",
        fields: sortFields(success.fields),
        results: success.results,
        webSearch: success.webSearch,
        ocr: success.ocr,
      });

      const initial: Record<string, RowData> = {};
      for (const result of success.results) {
        if (result.row) initial[result.model] = { ...result.row };
      }
      setEditedRows(initial);

      const okCount = success.results.filter((r) => r.ok).length;
      setNote(`Completed: ${okCount}/${success.results.length} models returned results.`);
    } catch (runError: unknown) {
      setError(runError instanceof Error ? runError.message : "Extraction failed.");
    } finally {
      setRunning(false);
    }
  };

  const updateCell = (model: string, fieldKey: string, value: string) => {
    setEditedRows((prev) => ({ ...prev, [model]: { ...prev[model], [fieldKey]: value } }));
  };

  const commonFormatFor = (model: string): string => {
    if (!selectedConfig) return "";
    return renderCommonFormat(selectedConfig.commonFormatTemplate, editedRows[model] ?? {});
  };

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(message);
      setError(null);
    } catch {
      setError("Clipboard write failed.");
    }
  };

  const copyModelRow = (model: string) => {
    const ordered = run?.fields ?? fields;
    const cells = ordered.map((f) => sanitize(editedRows[model]?.[f.fieldKey] ?? ""));
    void copyText([...cells, sanitize(commonFormatFor(model))].join("\t"), `Copied ${model} row (TSV).`);
  };

  const downloadComparisonCsv = () => {
    if (!run) return;
    const ordered = run.fields;
    const header = ["Model", ...ordered.map((f) => f.fieldLabel), "Common Format"].map(escapeCsv).join(",");
    const lines = run.results
      .filter((r) => r.ok)
      .map((r) =>
        [escapeCsv(r.model), ...ordered.map((f) => escapeCsv(editedRows[r.model]?.[f.fieldKey] ?? "")), escapeCsv(commonFormatFor(r.model))].join(","),
      );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedConfig?.id ?? "category"}-comparison.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /* ----- Category editor ----- */
  const startNewCategory = () => {
    const id = `category_${Math.random().toString(36).slice(2, 8)}`;
    setConfigDraft(blankCategory(id));
    setIsNewCategory(true);
    setShowEditor(true);
  };

  const updateDraft = (updater: (current: CategoryConfig) => CategoryConfig) =>
    setConfigDraft((current) => (current ? updater(current) : current));

  const updateDraftField = (index: number, updater: (field: CategoryFieldConfig) => CategoryFieldConfig) =>
    updateDraft((current) => ({
      ...current,
      fields: current.fields.map((field, i) => (i === index ? updater(field) : field)),
    }));

  const addDraftField = () =>
    updateDraft((current) => ({
      ...current,
      fields: [
        ...current.fields,
        {
          fieldKey: `field_${current.fields.length + 1}`,
          fieldLabel: `Field ${current.fields.length + 1}`,
          schemaType: "string",
          itemSchemaType: null,
          promptDescription: "Describe what this field captures.",
          required: true,
          displayOrder: current.fields.length,
          isKeyword: false,
        },
      ],
    }));

  const removeDraftField = (index: number) =>
    updateDraft((current) => ({ ...current, fields: current.fields.filter((_, i) => i !== index) }));

  const saveConfig = async () => {
    if (!configDraft) return;
    setConfigSaving(true);
    setError(null);
    setNote(null);
    const normalized: CategoryConfig = {
      ...configDraft,
      keywordDelimiter: normalizeKeywordDelimiter(configDraft.keywordDelimiter),
      fields: configDraft.fields.map((field, index) => ({ ...field, displayOrder: index })),
    };
    try {
      const response = await fetch("/api/category-configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      const payload = (await response.json()) as { category?: CategoryConfig; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");
      setNote(`Saved ${normalized.label}.`);
      setIsNewCategory(false);
      await loadConfigs();
      setCategoryId(normalized.id);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setConfigSaving(false);
    }
  };

  const deleteCategory = async () => {
    if (!configDraft || isNewCategory) return;
    if (!window.confirm(`Delete category "${configDraft.label}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/category-configs?id=${encodeURIComponent(configDraft.id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Delete failed.");
      setNote("Category deleted.");
      setShowEditor(false);
      await loadConfigs();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    }
  };

  /* ----- Render ----- */
  if (!authReady || !me) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f7f2ee] text-sm text-black/60">Loading…</div>;
  }

  const showLink = selectedConfig?.parserType === "e_paper_link" || Boolean(selectedConfig?.linkFieldLabel);
  const showText = selectedConfig?.parserType === "correspondence" || Boolean(selectedConfig?.textFieldLabel);
  const showCaption = selectedConfig?.parserType === "social_post" || Boolean(selectedConfig?.captionFieldLabel);

  return (
    <>
      <Head>
        <title>Extractor · Dynamic Media Extractor</title>
      </Head>
      <div className="min-h-screen bg-[radial-gradient(circle_at_20%_10%,#f2dfd4_0,#f7f2ee_38%,#f3f7ff_100%)] text-[#131313]">
        <AppNav user={me} />
        <main className="mx-auto w-full max-w-[1900px] px-4 pb-16 pt-6 sm:px-8">
          {configLoading ? (
            <section className="rounded-2xl border border-black/10 bg-white/80 p-4 text-sm text-black/70">
              Loading categories…
            </section>
          ) : null}
          {configError ? (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
              {configError}
            </section>
          ) : null}

          {selectedConfig ? (
            <>
              <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                {/* ------- Input form ------- */}
                <form
                  onSubmit={onExtract}
                  className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="category" className="block text-sm font-semibold">
                        Category
                      </label>
                      <select
                        id="category"
                        value={selectedConfig.id}
                        onChange={(event) => setCategoryId(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                      >
                        {configs.map((config) => (
                          <option key={config.id} value={config.id}>
                            {config.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="rounded-2xl border border-black/10 bg-[#f8f4f2] px-3 py-2 text-xs leading-5 text-black/75">
                      <p className="font-semibold">{selectedConfig.label}</p>
                      <p className="mt-1">{selectedConfig.description}</p>
                    </div>
                  </div>

                  {selectedConfig.allowFile ? (
                    <>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="upload" className="block text-sm font-semibold">
                            {selectedConfig.fileLabel || "Upload file"}
                          </label>
                          <input
                            id="upload"
                            ref={fileInputRef}
                            type="file"
                            accept={selectedConfig.fileAccept || "*/*"}
                            required={selectedConfig.requiresFile}
                            className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label htmlFor="ocr" className="block text-sm font-semibold">
                            OCR engine
                          </label>
                          <select
                            id="ocr"
                            value={ocrEngine}
                            onChange={(event) => setOcrEngine(event.target.value as OcrEngine)}
                            className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                          >
                            {OCR_ENGINE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {ocrEngine === "paddle" ? (
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <div>
                            <label htmlFor="ocrLang" className="block text-sm font-semibold">
                              OCR language
                            </label>
                            <select
                              id="ocrLang"
                              value={ocrLang}
                              onChange={(event) => {
                                setOcrLang(event.target.value);
                                setCustomLang("");
                              }}
                              className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                            >
                              {ocrLanguages.map((language) => (
                                <option key={language.code} value={language.code}>
                                  {language.label} ({language.code})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor="customLang" className="block text-sm font-semibold">
                              or custom code
                            </label>
                            <input
                              id="customLang"
                              value={customLang}
                              onChange={(event) => setCustomLang(event.target.value)}
                              placeholder="e.g. bn, latin…"
                              className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                            />
                          </div>
                          <p className="text-[11px] text-black/50 sm:col-span-2">
                            PaddleOCR loads a model per language. Note: Gujarati has no PaddleOCR model — use Reducto for
                            Gujarati.
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {showLink ? (
                    <div className="mt-4">
                      <label htmlFor="link" className="block text-sm font-semibold">
                        {selectedConfig.linkFieldLabel || "Link"}
                      </label>
                      <input
                        id="link"
                        type="url"
                        value={linkInput}
                        onChange={(event) => setLinkInput(event.target.value)}
                        placeholder="https://example.com/article"
                        className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                      />
                    </div>
                  ) : null}

                  {showText ? (
                    <div className="mt-4">
                      <label htmlFor="text" className="block text-sm font-semibold">
                        {selectedConfig.textFieldLabel || "Text input"}
                      </label>
                      <textarea
                        id="text"
                        value={textInput}
                        onChange={(event) => setTextInput(event.target.value)}
                        rows={5}
                        placeholder="Paste text here…"
                        className="mt-2 w-full resize-y rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                      />
                    </div>
                  ) : null}

                  {showCaption ? (
                    <div className="mt-4">
                      <label htmlFor="caption" className="block text-sm font-semibold">
                        {selectedConfig.captionFieldLabel || "Caption"}
                      </label>
                      <textarea
                        id="caption"
                        value={captionInput}
                        onChange={(event) => setCaptionInput(event.target.value)}
                        rows={3}
                        placeholder="Paste caption here…"
                        className="mt-2 w-full resize-y rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                      />
                    </div>
                  ) : null}

                  <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-black/80">
                    <input type="checkbox" checked={webSearch} onChange={(event) => setWebSearch(event.target.checked)} />
                    Enable web search augmentation
                  </label>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={running}
                      className="rounded-full bg-[#1e3f52] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#152f3d] disabled:opacity-50"
                    >
                      {running ? "Processing…" : `Run ${selectedModels.length} model${selectedModels.length === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </form>

                {/* ------- Model selector ------- */}
                <aside className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">AI models (OpenRouter)</p>
                    <span className="rounded-full bg-[#1e3f52] px-2 py-0.5 text-[11px] font-semibold text-white">
                      {selectedModels.length} selected
                    </span>
                  </div>

                  {selectedModels.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedModels.map((model) => (
                        <button
                          key={model}
                          type="button"
                          onClick={() => toggleModel(model)}
                          className="rounded-full bg-[#8f3f2d] px-2.5 py-1 text-[11px] font-semibold text-white"
                          title="Remove"
                        >
                          {model} ✕
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <input
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder="Search models or type an exact id…"
                    className="mt-3 w-full rounded-xl border border-black/15 px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                  />
                  {modelQuery.trim() && !filteredCatalog.some((m) => m.id === modelQuery.trim()) ? (
                    <button
                      type="button"
                      onClick={() => {
                        toggleModel(modelQuery.trim());
                        setModelQuery("");
                      }}
                      className="mt-2 w-full rounded-lg border border-dashed border-black/25 px-3 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/5"
                    >
                      + Add “{modelQuery.trim()}”
                    </button>
                  ) : null}

                  {modelCatalogError ? (
                    <p className="mt-2 text-[11px] text-amber-700">
                      Catalog unavailable ({modelCatalogError}). You can still type exact model ids.
                    </p>
                  ) : null}

                  <div className="mt-2 max-h-[220px] overflow-auto rounded-xl border border-black/10">
                    {filteredCatalog.map((model) => {
                      const active = selectedModels.includes(model.id);
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => toggleModel(model.id)}
                          className={`flex w-full items-center justify-between gap-2 border-b border-black/5 px-3 py-2 text-left text-xs transition last:border-b-0 ${
                            active ? "bg-[#ecf4fa]" : "hover:bg-black/5"
                          }`}
                        >
                          <span className="truncate">
                            <span className="font-semibold">{model.name}</span>
                            <span className="ml-1 text-black/45">{model.id}</span>
                          </span>
                          <span className={`shrink-0 text-[11px] ${active ? "text-[#1e3f52]" : "text-black/40"}`}>
                            {active ? "✓ selected" : "add"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-black/50">
                    Select multiple models to compare accuracy side by side.
                  </p>
                </aside>
              </section>

              {error ? (
                <p className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              ) : null}
              {note ? (
                <p className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {note}
                </p>
              ) : null}

              {/* ------- Comparison results ------- */}
              {run ? (
                <section className="mt-4 overflow-hidden rounded-3xl border border-black/10 bg-white/90 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-5 py-3">
                    <div className="text-sm">
                      <span className="font-semibold">Comparison</span>
                      <span className="ml-2 text-black/55">
                        {run.fileName} · {run.webSearch ? "web search on" : "web search off"}
                        {run.ocr ? ` · ${run.ocr.engine} OCR${run.ocr.numPages ? ` (${run.ocr.numPages}p)` : ""}` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={downloadComparisonCsv}
                      className="rounded-full border border-black/20 px-4 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                    >
                      Download comparison CSV
                    </button>
                  </div>

                  <div className="max-h-[74vh] overflow-auto">
                    <table className="min-w-[900px] border-collapse text-sm">
                      <thead className="sticky top-0 z-10 bg-[#1e3f52] text-white">
                        <tr>
                          <th className="border border-[#173140] px-3 py-3 text-left font-semibold">Field</th>
                          {run.results.map((result) => (
                            <th key={result.model} className="border border-[#173140] px-3 py-3 text-left font-semibold">
                              <div className="min-w-[240px]">
                                <div className="truncate">{result.model}</div>
                                <div className="mt-0.5 text-[11px] font-normal text-white/70">
                                  {result.ok
                                    ? `${result.latencyMs ?? "?"}ms${
                                        result.usage?.cost != null ? ` · $${Number(result.usage.cost).toFixed(4)}` : ""
                                      }`
                                    : "failed"}
                                </div>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {run.fields.map((field) => (
                          <tr key={field.fieldKey} className="even:bg-[#f7f9fc]">
                            <td className="border border-black/10 px-3 py-2 align-top">
                              <div className="min-w-[160px] font-semibold">{field.fieldLabel}</div>
                              {field.isKeyword ? (
                                <div className="text-[11px] text-[#8f3f2d]">
                                  keywords · “{normalizeKeywordDelimiter(selectedConfig.keywordDelimiter)}”
                                </div>
                              ) : null}
                            </td>
                            {run.results.map((result) => (
                              <td key={`${result.model}-${field.fieldKey}`} className="border border-black/10 p-1.5 align-top">
                                {result.ok ? (
                                  <textarea
                                    value={editedRows[result.model]?.[field.fieldKey] ?? ""}
                                    onChange={(event) => updateCell(result.model, field.fieldKey, event.target.value)}
                                    rows={field.fieldKey.toLowerCase().includes("matter") || field.fieldKey.toLowerCase().includes("summary") ? 5 : 2}
                                    className="w-full min-w-[240px] resize-y rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm leading-5 focus:border-[#8f3f2d] focus:outline-none"
                                  />
                                ) : (
                                  <div className="min-w-[240px] rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                                    {result.error}
                                  </div>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr className="bg-[#fbf6f3]">
                          <td className="border border-black/10 px-3 py-2 align-top font-semibold">Common Format</td>
                          {run.results.map((result) => (
                            <td key={`${result.model}-common`} className="border border-black/10 p-2 align-top">
                              {result.ok ? (
                                <div className="min-w-[240px] space-y-2">
                                  <div className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs leading-5 text-black/80">
                                    {commonFormatFor(result.model)}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => copyModelRow(result.model)}
                                    className="rounded-full border border-black/20 px-3 py-1 text-[11px] font-semibold transition hover:bg-black/5"
                                  >
                                    Copy row (TSV)
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-black/40">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {/* ------- Category editor ------- */}
              <section className="mt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowEditor((prev) => !prev)}
                    className="rounded-full border border-black/20 px-4 py-2 text-sm font-semibold transition hover:bg-black/5"
                  >
                    {showEditor ? "Hide category editor" : "Show category editor"}
                  </button>
                  {me.canCreateCategories ? (
                    <button
                      type="button"
                      onClick={startNewCategory}
                      className="rounded-full bg-[#8f3f2d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#7b3323]"
                    >
                      + New category
                    </button>
                  ) : null}
                  {isNewCategory ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      Editing a new category
                    </span>
                  ) : null}
                </div>

                {showEditor && configDraft && (canManageCurrent || isNewCategory) ? (
                  <div className="mt-4 rounded-3xl border border-black/10 bg-white/90 p-5 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold">Category Configuration</p>
                      <div className="flex flex-wrap gap-2">
                        {!isNewCategory ? (
                          <button
                            type="button"
                            onClick={() => setConfigDraft(selectedConfig ? cloneConfig(selectedConfig) : null)}
                            className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                          >
                            Reset
                          </button>
                        ) : null}
                        {!isNewCategory ? (
                          <button
                            type="button"
                            onClick={deleteCategory}
                            className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            Delete
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={saveConfig}
                          disabled={configSaving}
                          className="rounded-full bg-[#1e3f52] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#152f3d] disabled:opacity-60"
                        >
                          {configSaving ? "Saving…" : isNewCategory ? "Create category" : "Save config"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        Category id
                        <input
                          value={configDraft.id}
                          disabled={!isNewCategory}
                          onChange={(event) => updateDraft((c) => ({ ...c, id: event.target.value.trim() }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case disabled:bg-black/5"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        Label
                        <input
                          value={configDraft.label}
                          onChange={(event) => updateDraft((c) => ({ ...c, label: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                        Description
                        <input
                          value={configDraft.description}
                          onChange={(event) => updateDraft((c) => ({ ...c, description: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        Parser type
                        <select
                          value={configDraft.parserType}
                          onChange={(event) => updateDraft((c) => ({ ...c, parserType: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        >
                          {PARSER_TYPE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        Default OCR engine
                        <select
                          value={configDraft.defaultOcrEngine}
                          onChange={(event) => updateDraft((c) => ({ ...c, defaultOcrEngine: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        >
                          {OCR_ENGINE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        Keyword delimiter
                        <input
                          value={configDraft.keywordDelimiter}
                          maxLength={1}
                          onChange={(event) => updateDraft((c) => ({ ...c, keywordDelimiter: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                          placeholder="/"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm font-semibold text-black/80">
                        <input
                          type="checkbox"
                          checked={configDraft.enableWebSearch}
                          onChange={(event) => updateDraft((c) => ({ ...c, enableWebSearch: event.target.checked }))}
                        />
                        Web search on by default
                      </label>
                      <label className="flex items-center gap-2 text-sm font-semibold text-black/80">
                        <input
                          type="checkbox"
                          checked={configDraft.allowFile}
                          onChange={(event) => updateDraft((c) => ({ ...c, allowFile: event.target.checked }))}
                        />
                        Allow file upload
                      </label>
                      <label className="flex items-center gap-2 text-sm font-semibold text-black/80">
                        <input
                          type="checkbox"
                          checked={configDraft.requiresFile}
                          onChange={(event) => updateDraft((c) => ({ ...c, requiresFile: event.target.checked }))}
                        />
                        File required
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        File label
                        <input
                          value={configDraft.fileLabel}
                          onChange={(event) => updateDraft((c) => ({ ...c, fileLabel: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        File accept
                        <input
                          value={configDraft.fileAccept}
                          onChange={(event) => updateDraft((c) => ({ ...c, fileAccept: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        Link input label
                        <input
                          value={configDraft.linkFieldLabel}
                          onChange={(event) => updateDraft((c) => ({ ...c, linkFieldLabel: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        Text input label
                        <input
                          value={configDraft.textFieldLabel}
                          onChange={(event) => updateDraft((c) => ({ ...c, textFieldLabel: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                        Caption input label
                        <input
                          value={configDraft.captionFieldLabel}
                          onChange={(event) => updateDraft((c) => ({ ...c, captionFieldLabel: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                        Default models (comma-separated ids)
                        <input
                          value={configDraft.defaultModels.join(", ")}
                          onChange={(event) =>
                            updateDraft((c) => ({
                              ...c,
                              defaultModels: event.target.value.split(",").map((m) => m.trim()).filter(Boolean),
                            }))
                          }
                          placeholder="anthropic/claude-sonnet-4, openai/gpt-4o"
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                        AI system prompt
                        <textarea
                          rows={4}
                          value={configDraft.aiSystemPrompt}
                          onChange={(event) => updateDraft((c) => ({ ...c, aiSystemPrompt: event.target.value }))}
                          className="mt-1 w-full resize-y rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                        AI task prompt
                        <textarea
                          rows={3}
                          value={configDraft.aiTaskPrompt}
                          onChange={(event) => updateDraft((c) => ({ ...c, aiTaskPrompt: event.target.value }))}
                          className="mt-1 w-full resize-y rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                        Common format template (placeholders like {"{{title}}"})
                        <input
                          value={configDraft.commonFormatTemplate}
                          onChange={(event) => updateDraft((c) => ({ ...c, commonFormatTemplate: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                        />
                      </label>
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <p className="text-sm font-semibold">Fields</p>
                      <button
                        type="button"
                        onClick={addDraftField}
                        className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                      >
                        Add field
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      {configDraft.fields.map((field, index) => (
                        <div key={index} className="rounded-2xl border border-black/10 bg-[#f9fbfe] p-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                              Field key
                              <input
                                value={field.fieldKey}
                                onChange={(event) => updateDraftField(index, (f) => ({ ...f, fieldKey: event.target.value }))}
                                className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                              />
                            </label>
                            <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                              Field label
                              <input
                                value={field.fieldLabel}
                                onChange={(event) => updateDraftField(index, (f) => ({ ...f, fieldLabel: event.target.value }))}
                                className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                              />
                            </label>
                            <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                              Schema type
                              <select
                                value={field.schemaType}
                                onChange={(event) =>
                                  updateDraftField(index, (f) => ({
                                    ...f,
                                    schemaType: event.target.value as FieldSchemaType,
                                    itemSchemaType: event.target.value === "array" ? f.itemSchemaType ?? "string" : null,
                                  }))
                                }
                                className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                              >
                                {FIELD_SCHEMA_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                              Array item type
                              <select
                                value={field.itemSchemaType ?? "string"}
                                disabled={field.schemaType !== "array"}
                                onChange={(event) =>
                                  updateDraftField(index, (f) => ({ ...f, itemSchemaType: event.target.value as ArrayItemSchemaType }))
                                }
                                className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case disabled:opacity-50"
                              >
                                {ARRAY_ITEM_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-black/70">
                              Prompt description
                              <textarea
                                rows={2}
                                value={field.promptDescription}
                                onChange={(event) => updateDraftField(index, (f) => ({ ...f, promptDescription: event.target.value }))}
                                className="mt-1 w-full resize-y rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                              />
                            </label>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4">
                            <label className="flex items-center gap-2 text-sm font-semibold text-black/80">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(event) => updateDraftField(index, (f) => ({ ...f, required: event.target.checked }))}
                              />
                              Required
                            </label>
                            <label className="flex items-center gap-2 text-sm font-semibold text-black/80">
                              <input
                                type="checkbox"
                                checked={field.isKeyword}
                                onChange={(event) => updateDraftField(index, (f) => ({ ...f, isKeyword: event.target.checked }))}
                              />
                              Keyword field (delimiter-joined)
                            </label>
                            <button
                              type="button"
                              onClick={() => removeDraftField(index)}
                              className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                            >
                              Remove field
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </main>
      </div>

      {running ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/95 p-6 shadow-[0_30px_90px_-35px_rgba(15,23,42,0.6)]">
            <div className="flex items-center gap-3">
              <span className="h-6 w-6 rounded-full border-2 border-[#1e3f52]/30 border-t-[#1e3f52] animate-spin" />
              <p className="text-base font-semibold text-[#1e3f52]">Running {selectedModels.length} model(s)…</p>
            </div>
            <p className="mt-3 text-sm text-black/70">OCR → extraction → structuring across selected models.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
