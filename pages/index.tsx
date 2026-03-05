import Head from "next/head";
import Image from "next/image";
import { Source_Serif_4, Space_Grotesk } from "next/font/google";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  renderCommonFormat,
  sortFields,
  type ArrayItemSchemaType,
  type CategoryConfig,
  type CategoryFieldConfig,
  type FieldSchemaType,
  type RowData,
} from "@/lib/category-config";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
});

type ProcessSuccessResponse = {
  categoryId: string;
  categoryLabel: string;
  row: RowData;
  fields: CategoryFieldConfig[];
  commonFormat: string;
  usage?: {
    numPages?: number;
    numFields?: number;
    credits?: number | null;
  };
  jobId?: string | null;
  fileName?: string | null;
};

type ProcessErrorResponse = {
  error: string;
};

type ConfigListResponse = {
  categories: CategoryConfig[];
};

type ConfigSaveResponse = {
  category: CategoryConfig;
};

type ExtractRecord = {
  id: string;
  categoryId: string;
  fileName: string;
  row: RowData;
  commonFormat: string;
  usage?: ProcessSuccessResponse["usage"];
  jobId?: string | null;
};

type PreviewAsset = {
  fileName: string;
  url: string;
  mimeType: string;
};

const PARSER_TYPE_OPTIONS = [
  "newspaper_pdf",
  "photo_image",
  "e_paper_link",
  "correspondence",
  "social_post",
];

const FIELD_SCHEMA_OPTIONS: FieldSchemaType[] = ["string", "number", "boolean", "array"];
const ARRAY_ITEM_OPTIONS = ["string", "number", "boolean", "object"] as const;

function cloneConfig(config: CategoryConfig): CategoryConfig {
  return {
    ...config,
    fields: config.fields.map((field) => ({ ...field })),
  };
}

function sanitizeForDelimited(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\t/g, " ").trim();
}

function escapeCsvCell(value: string): string {
  const normalized = sanitizeForDelimited(value).replaceAll('"', '""');
  return `"${normalized}"`;
}

function buildRowTsv(record: ExtractRecord, fields: CategoryFieldConfig[]): string {
  const ordered = sortFields(fields);
  return [...ordered.map((field) => sanitizeForDelimited(record.row[field.fieldKey] ?? "")), record.commonFormat].join(
    "\t",
  );
}

function buildTsv(records: ExtractRecord[], fields: CategoryFieldConfig[], includeHeaders = true): string {
  const ordered = sortFields(fields);
  const lines = records.map((record) => buildRowTsv(record, ordered));

  if (!includeHeaders) {
    return lines.join("\n");
  }

  const header = [...ordered.map((field) => field.fieldLabel), "Common Format"].join("\t");
  return [header, ...lines].join("\n");
}

function buildRowCsv(record: ExtractRecord, fields: CategoryFieldConfig[]): string {
  const ordered = sortFields(fields);
  return [...ordered.map((field) => escapeCsvCell(record.row[field.fieldKey] ?? "")), escapeCsvCell(record.commonFormat)].join(
    ",",
  );
}

function buildCsv(records: ExtractRecord[], fields: CategoryFieldConfig[], includeHeaders = true): string {
  const ordered = sortFields(fields);
  const lines = records.map((record) => buildRowCsv(record, ordered));

  if (!includeHeaders) {
    return lines.join("\n");
  }

  const header = [...ordered.map((field) => field.fieldLabel), "Common Format"].map(escapeCsvCell).join(",");
  return [header, ...lines].join("\n");
}

function isPdfFromPreview(preview: PreviewAsset): boolean {
  if (preview.mimeType === "application/pdf") {
    return true;
  }

  return preview.fileName.toLowerCase().endsWith(".pdf");
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const loadingMessages = [
    "Uploading input...",
    "Running extraction pipeline...",
    "Structuring response...",
    "Preparing editable row...",
  ];

  const [configs, setConfigs] = useState<CategoryConfig[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configLoadingError, setConfigLoadingError] = useState<string | null>(null);

  const [categoryId, setCategoryId] = useState<string>("");
  const [recordsByCategory, setRecordsByCategory] = useState<Record<string, ExtractRecord[]>>({});

  const [configDraft, setConfigDraft] = useState<CategoryConfig | null>(null);
  const [configSaving, setConfigSaving] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [linkInput, setLinkInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [captionInput, setCaptionInput] = useState("");

  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);

  const selectedConfig = useMemo(
    () => configs.find((config) => config.id === categoryId) ?? null,
    [configs, categoryId],
  );

  const fields = useMemo(() => sortFields(selectedConfig?.fields ?? []), [selectedConfig]);

  const records = useMemo(() => recordsByCategory[categoryId] ?? [], [recordsByCategory, categoryId]);
  const latestRecord = useMemo(() => records.at(-1) ?? null, [records]);

  const loadConfigs = async () => {
    setConfigLoading(true);
    setConfigLoadingError(null);

    try {
      const response = await fetch("/api/category-configs");
      const payload = (await response.json()) as ConfigListResponse | ProcessErrorResponse;

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Could not load category configs.");
      }

      const categoryConfigs = (payload as ConfigListResponse).categories;
      setConfigs(categoryConfigs);

      if (!categoryConfigs.length) {
        setConfigLoadingError("No category configs found in Turso. Run `npm run db:seed-config`.");
        setCategoryId("");
        return;
      }

      setCategoryId((previous) => {
        if (previous && categoryConfigs.some((config) => config.id === previous)) {
          return previous;
        }

        return categoryConfigs[0].id;
      });
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : "Could not load category configs.";
      setConfigLoadingError(message);
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    void loadConfigs();
  }, []);

  useEffect(() => {
    if (!selectedConfig) {
      setConfigDraft(null);
      return;
    }

    setConfigDraft(cloneConfig(selectedConfig));
  }, [selectedConfig]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingStepIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingStepIndex((previous) => (previous + 1) % loadingMessages.length);
    }, 1400);

    return () => {
      window.clearInterval(interval);
    };
  }, [loading, loadingMessages.length]);

  const setFilePreview = (file: File | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    if (!file) {
      setPreviewAsset(null);
      return;
    }

    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreviewAsset({
      fileName: file.name,
      url,
      mimeType: file.type,
    });
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFilePreview(file);
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setNote(successMessage);
    } catch {
      setError("Clipboard write failed. Use download CSV instead.");
    }
  };

  const onExtract = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedConfig) {
      setError("No category selected.");
      return;
    }

    const formElement = event.currentTarget;

    setError(null);
    setNote(null);

    const file = fileInputRef.current?.files?.[0] ?? null;

    if (selectedConfig.requiresFile && !file) {
      setError("Please upload a file for this category.");
      return;
    }

    if (selectedConfig.parserType === "e_paper_link" && !linkInput.trim()) {
      setError("Please provide the link input.");
      return;
    }

    if (selectedConfig.parserType === "correspondence" && !file && !textInput.trim()) {
      setError("Provide either a file or text input.");
      return;
    }

    if (selectedConfig.parserType === "social_post" && !file && !captionInput.trim()) {
      setError("Provide caption input, file upload, or both.");
      return;
    }

    const formData = new FormData();
    formData.append("category", selectedConfig.id);

    if (file) {
      formData.append("file", file);
      setFilePreview(file);
    }

    if (selectedConfig.parserType === "e_paper_link") {
      formData.append("link", linkInput.trim());
    }

    if (selectedConfig.parserType === "correspondence") {
      formData.append("textInput", textInput.trim());
    }

    if (selectedConfig.parserType === "social_post") {
      formData.append("captionInput", captionInput.trim());
    }

    setLoading(true);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as ProcessSuccessResponse | ProcessErrorResponse;

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Processing failed.");
      }

      const successPayload = payload as ProcessSuccessResponse;

      const newRecord: ExtractRecord = {
        id: crypto.randomUUID(),
        categoryId: successPayload.categoryId,
        fileName: successPayload.fileName || file?.name || "input",
        row: successPayload.row,
        commonFormat: successPayload.commonFormat,
        usage: successPayload.usage,
        jobId: successPayload.jobId,
      };

      setRecordsByCategory((previous) => ({
        ...previous,
        [successPayload.categoryId]: [...(previous[successPayload.categoryId] ?? []), newRecord],
      }));

      setNote(`Processed successfully for ${selectedConfig.label}.`);

      formElement.reset();
      setLinkInput("");
      setTextInput("");
      setCaptionInput("");
    } catch (requestError: unknown) {
      const message = requestError instanceof Error ? requestError.message : "Processing failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const updateCell = (recordIndex: number, fieldKey: string, value: string) => {
    if (!selectedConfig) {
      return;
    }

    setRecordsByCategory((previous) => {
      const current = previous[selectedConfig.id] ?? [];

      const updated = current.map((record, index) => {
        if (index !== recordIndex) {
          return record;
        }

        const updatedRow = {
          ...record.row,
          [fieldKey]: value,
        };

        return {
          ...record,
          row: updatedRow,
          commonFormat: renderCommonFormat(selectedConfig.commonFormatTemplate, updatedRow),
        };
      });

      return {
        ...previous,
        [selectedConfig.id]: updated,
      };
    });
  };

  const addBlankRow = () => {
    if (!selectedConfig) {
      return;
    }

    const row = fields.reduce<RowData>((accumulator, field) => {
      accumulator[field.fieldKey] = "";
      return accumulator;
    }, {});

    const record: ExtractRecord = {
      id: crypto.randomUUID(),
      categoryId: selectedConfig.id,
      fileName: "manual-entry",
      row,
      commonFormat: renderCommonFormat(selectedConfig.commonFormatTemplate, row),
      usage: undefined,
      jobId: undefined,
    };

    setRecordsByCategory((previous) => ({
      ...previous,
      [selectedConfig.id]: [...(previous[selectedConfig.id] ?? []), record],
    }));
  };

  const onCopyTsv = async () => {
    if (!records.length) {
      return;
    }

    await copyText(buildTsv(records, fields, false), "Copied row values in TSV (no headers).");
  };

  const onCopyCsv = async () => {
    if (!records.length) {
      return;
    }

    await copyText(buildCsv(records, fields, false), "Copied row values in CSV (no headers).");
  };

  const onDownloadCsv = () => {
    if (!records.length) {
      return;
    }

    const csv = buildCsv(records, fields);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedConfig?.id ?? "category"}-extractions.csv`;
    anchor.click();

    URL.revokeObjectURL(url);
  };

  const onCopyCommon = async (record: ExtractRecord) => {
    await copyText(record.commonFormat, "Copied common format text to clipboard.");
  };

  const onCopyRow = async (record: ExtractRecord) => {
    await copyText(buildRowTsv(record, fields), "Copied selected row values (no headers).");
  };

  const onRemoveRow = (recordIndex: number) => {
    if (!selectedConfig) {
      return;
    }

    setRecordsByCategory((previous) => ({
      ...previous,
      [selectedConfig.id]: (previous[selectedConfig.id] ?? []).filter((_, index) => index !== recordIndex),
    }));

    setError(null);
    setNote("Row removed.");
  };

  const updateDraft = (updater: (current: CategoryConfig) => CategoryConfig) => {
    setConfigDraft((current) => {
      if (!current) {
        return current;
      }

      return updater(current);
    });
  };

  const updateDraftField = (index: number, updater: (field: CategoryFieldConfig) => CategoryFieldConfig) => {
    updateDraft((current) => {
      const nextFields = current.fields.map((field, fieldIndex) =>
        fieldIndex === index ? updater(field) : field,
      );

      return {
        ...current,
        fields: nextFields,
      };
    });
  };

  const addDraftField = () => {
    updateDraft((current) => ({
      ...current,
      fields: [
        ...current.fields,
        {
          fieldKey: `new_field_${current.fields.length + 1}`,
          fieldLabel: `New Field ${current.fields.length + 1}`,
          schemaType: "string",
          itemSchemaType: null,
          promptDescription: "Describe what this field should capture.",
          required: true,
          displayOrder: current.fields.length,
        },
      ],
    }));
  };

  const removeDraftField = (index: number) => {
    updateDraft((current) => ({
      ...current,
      fields: current.fields.filter((_, fieldIndex) => fieldIndex !== index),
    }));
  };

  const saveConfig = async () => {
    if (!configDraft) {
      return;
    }

    setConfigSaving(true);
    setError(null);
    setNote(null);

    const normalizedDraft: CategoryConfig = {
      ...configDraft,
      fields: configDraft.fields.map((field, index) => ({
        ...field,
        displayOrder: index,
      })),
    };

    try {
      const response = await fetch("/api/category-configs", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalizedDraft),
      });

      const payload = (await response.json()) as ConfigSaveResponse | ProcessErrorResponse;

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Config save failed.");
      }

      const saved = (payload as ConfigSaveResponse).category;

      setConfigs((previous) => {
        const exists = previous.some((config) => config.id === saved.id);

        if (!exists) {
          return [...previous, saved];
        }

        return previous.map((config) => (config.id === saved.id ? saved : config));
      });

      setConfigDraft(cloneConfig(saved));
      setNote(`Saved config for ${saved.label}.`);
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : "Config save failed.";
      setError(message);
    } finally {
      setConfigSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>Dynamic Media Extractor</title>
        <meta
          name="description"
          content="DB-driven extraction categories with editable field schema and prompts (Turso + Reducto + Sarvam)."
        />
      </Head>

      <div
        className={`${spaceGrotesk.variable} ${sourceSerif.variable} min-h-screen bg-[radial-gradient(circle_at_20%_10%,#f2dfd4_0,#f7f2ee_38%,#f3f7ff_100%)] text-[#131313]`}
      >
        <main className="mx-auto w-full max-w-[1900px] px-4 pb-16 pt-8 sm:px-8">
          <section className="mb-6 rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_20px_80px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#8f3f2d]">
              Turso Dynamic Config
            </p>
            <h1 className="font-[var(--font-source-serif)] text-3xl leading-tight sm:text-4xl">
              Transparent Prompt + Schema Extractor
            </h1>
            <p className="mt-3 max-w-5xl text-sm leading-6 text-black/70 sm:text-base">
              Category behavior, fields, schema types, prompt descriptions, and common output templates now come
              from Turso. Edit any of them below and save instantly.
            </p>
          </section>

          {configLoading ? (
            <section className="rounded-2xl border border-black/10 bg-white/80 p-4 text-sm text-black/75">
              Loading category configs from Turso...
            </section>
          ) : null}

          {configLoadingError ? (
            <section className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
              {configLoadingError}
            </section>
          ) : null}

          {!configLoading && selectedConfig ? (
            <>
              <section className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
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
                        onChange={(event) => {
                          setCategoryId(event.target.value);
                          setError(null);
                          setNote(null);
                        }}
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
                      <p className="font-semibold">Selected workflow</p>
                      <p className="mt-1">{selectedConfig.description}</p>
                    </div>
                  </div>

                  {selectedConfig.allowFile ? (
                    <div className="mt-4">
                      <label htmlFor="upload" className="block text-sm font-semibold">
                        {selectedConfig.fileLabel || "Upload file"}
                      </label>
                      <input
                        id="upload"
                        ref={fileInputRef}
                        type="file"
                        accept={selectedConfig.fileAccept || "*/*"}
                        required={selectedConfig.requiresFile}
                        onChange={onFileChange}
                        className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                      />
                    </div>
                  ) : null}

                  {selectedConfig.parserType === "e_paper_link" ? (
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

                  {selectedConfig.parserType === "correspondence" ? (
                    <div className="mt-4">
                      <label htmlFor="textInput" className="block text-sm font-semibold">
                        {selectedConfig.textFieldLabel || "Text input"}
                      </label>
                      <textarea
                        id="textInput"
                        value={textInput}
                        onChange={(event) => setTextInput(event.target.value)}
                        rows={6}
                        placeholder="Paste text here..."
                        className="mt-2 w-full resize-y rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                      />
                    </div>
                  ) : null}

                  {selectedConfig.parserType === "social_post" ? (
                    <div className="mt-4">
                      <label htmlFor="captionInput" className="block text-sm font-semibold">
                        {selectedConfig.captionFieldLabel || "Caption"}
                      </label>
                      <textarea
                        id="captionInput"
                        value={captionInput}
                        onChange={(event) => setCaptionInput(event.target.value)}
                        rows={4}
                        placeholder="Paste caption here..."
                        className="mt-2 w-full resize-y rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm focus:border-[#8f3f2d] focus:outline-none"
                      />
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-full bg-[#1e3f52] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#152f3d] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "Processing..." : "Run Process"}
                    </button>

                    <button
                      type="button"
                      onClick={addBlankRow}
                      className="rounded-full border border-black/20 px-5 py-2.5 text-sm font-semibold text-black/80 transition hover:bg-black/5"
                    >
                      Add Blank Row
                    </button>
                  </div>
                </form>

                <aside className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                  <p className="text-sm font-semibold">Latest Run ({selectedConfig.label})</p>
                  {loading ? (
                    <div className="mt-3 rounded-xl border border-[#1e3f52]/20 bg-[#ecf4fa] px-3 py-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#1e3f52]">
                        <span className="h-3 w-3 rounded-full bg-[#1e3f52] animate-pulse" />
                        Processing in progress
                      </div>
                      <p className="mt-1 text-xs text-[#1e3f52]/80">{loadingMessages[loadingStepIndex]}</p>
                    </div>
                  ) : null}
                  {latestRecord ? (
                    <div className="mt-3 space-y-2 text-sm text-black/75">
                      <p>
                        <span className="font-semibold text-black">Input:</span> {latestRecord.fileName}
                      </p>
                      <p>
                        <span className="font-semibold text-black">Pages processed:</span>{" "}
                        {latestRecord.usage?.numPages ?? "-"}
                      </p>
                      <p>
                        <span className="font-semibold text-black">Fields extracted:</span>{" "}
                        {latestRecord.usage?.numFields ?? "-"}
                      </p>
                      <p>
                        <span className="font-semibold text-black">Credits:</span> {latestRecord.usage?.credits ?? "-"}
                      </p>
                      <p>
                        <span className="font-semibold text-black">Job ID:</span> {latestRecord.jobId ?? "-"}
                      </p>
                      <button
                        type="button"
                        onClick={() => onCopyCommon(latestRecord)}
                        className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                      >
                        Copy Latest Common Format
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-black/65">No runs yet for this category.</p>
                  )}
                </aside>
              </section>

              <section className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onCopyTsv}
                  disabled={!records.length}
                  className="rounded-full bg-[#8f3f2d] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#7b3323] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Copy TSV (Excel)
                </button>
                <button
                  type="button"
                  onClick={onCopyCsv}
                  disabled={!records.length}
                  className="rounded-full border border-black/20 px-5 py-2 text-sm font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Copy CSV
                </button>
                <button
                  type="button"
                  onClick={onDownloadCsv}
                  disabled={!records.length}
                  className="rounded-full border border-black/20 px-5 py-2 text-sm font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download CSV
                </button>
              </section>

              {error ? (
                <p className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              ) : null}

              {note ? (
                <p className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {note}
                </p>
              ) : null}

              <section className="mt-4 overflow-hidden rounded-3xl border border-black/10 bg-white/90 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                <div className="max-h-[72vh] overflow-auto">
                  <table className="min-w-[1900px] border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-[#1e3f52] text-white">
                      <tr>
                        <th className="border border-[#173140] px-3 py-3 text-left font-semibold">#</th>
                        {fields.map((field) => (
                          <th key={field.fieldKey} className="border border-[#173140] px-3 py-3 text-left font-semibold">
                            {field.fieldLabel}
                          </th>
                        ))}
                        <th className="border border-[#173140] px-3 py-3 text-left font-semibold">Common Format</th>
                        <th className="border border-[#173140] px-3 py-3 text-left font-semibold">Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {records.length ? (
                        records.map((record, rowIndex) => (
                          <tr key={record.id} className="even:bg-[#f7f9fc]">
                            <td className="border border-black/10 px-3 py-2 align-top font-semibold">{rowIndex + 1}</td>

                            {fields.map((field) => (
                              <td key={`${record.id}-${field.fieldKey}`} className="border border-black/10 p-1.5 align-top">
                                <textarea
                                  value={record.row[field.fieldKey] ?? ""}
                                  onChange={(event) => updateCell(rowIndex, field.fieldKey, event.target.value)}
                                  rows={field.fieldKey.toLowerCase().includes("matter") ? 7 : field.fieldKey.toLowerCase().includes("summary") ? 5 : 3}
                                  className="w-full min-w-[220px] resize-y rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm leading-5 focus:border-[#8f3f2d] focus:outline-none"
                                />
                              </td>
                            ))}

                            <td className="border border-black/10 p-2 align-top">
                              <div className="min-w-[360px] rounded-xl border border-black/10 bg-white px-3 py-2 text-sm leading-6 text-black/80">
                                {record.commonFormat}
                              </div>
                            </td>

                            <td className="border border-black/10 px-3 py-2 align-top">
                              <div className="flex min-w-[150px] flex-col gap-2">
                                <button
                                  type="button"
                                  onClick={() => onCopyRow(record)}
                                  className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                                >
                                  Copy Row
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onCopyCommon(record)}
                                  className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                                >
                                  Copy Matter Line
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onRemoveRow(rowIndex)}
                                  className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                                >
                                  Remove Row
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={fields.length + 3} className="px-4 py-6 text-center text-black/65">
                            Run processing for this category to populate rows.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {previewAsset ? (
                <section className="mt-4 rounded-3xl border border-black/10 bg-white/85 p-4 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Uploaded File Preview</p>
                    <a
                      href={previewAsset.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                    >
                      Open in New Tab
                    </a>
                  </div>
                  <p className="mt-2 text-sm text-black/70">{previewAsset.fileName}</p>

                  {isPdfFromPreview(previewAsset) ? (
                    <div className="mt-3 h-[75vh] overflow-hidden rounded-2xl border border-black/10 bg-white">
                      <iframe src={previewAsset.url} title={`Preview ${previewAsset.fileName}`} className="h-full w-full" />
                    </div>
                  ) : previewAsset.mimeType.startsWith("image/") ? (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 bg-white p-2">
                      <div className="relative mx-auto h-[70vh] w-full max-w-[1200px]">
                        <Image
                          src={previewAsset.url}
                          alt={previewAsset.fileName}
                          fill
                          unoptimized
                          className="rounded-xl object-contain"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-black/70">Preview not available for this file type.</p>
                  )}
                </section>
              ) : null}

              {configDraft ? (
                <section className="mt-4 rounded-3xl border border-black/10 bg-white/90 p-5 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Category Config Editor (Turso)</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfigDraft(cloneConfig(selectedConfig))}
                        className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                      >
                        Reset Draft
                      </button>
                      <button
                        type="button"
                        onClick={saveConfig}
                        disabled={configSaving}
                        className="rounded-full bg-[#1e3f52] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#152f3d] disabled:opacity-60"
                      >
                        {configSaving ? "Saving..." : "Save Config"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                      Label
                      <input
                        value={configDraft.label}
                        onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                      Parser Type
                      <select
                        value={configDraft.parserType}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, parserType: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      >
                        {PARSER_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                      Description
                      <input
                        value={configDraft.description}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, description: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-black/80">
                      <input
                        type="checkbox"
                        checked={configDraft.allowFile}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, allowFile: event.target.checked }))
                        }
                      />
                      Allow file upload
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-black/80">
                      <input
                        type="checkbox"
                        checked={configDraft.requiresFile}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, requiresFile: event.target.checked }))
                        }
                      />
                      File required
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                      File Label
                      <input
                        value={configDraft.fileLabel}
                        onChange={(event) => updateDraft((current) => ({ ...current, fileLabel: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                      File Accept
                      <input
                        value={configDraft.fileAccept}
                        onChange={(event) => updateDraft((current) => ({ ...current, fileAccept: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                      Link Input Label
                      <input
                        value={configDraft.linkFieldLabel}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, linkFieldLabel: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                      Text Input Label
                      <input
                        value={configDraft.textFieldLabel}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, textFieldLabel: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                      Caption Input Label
                      <input
                        value={configDraft.captionFieldLabel}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, captionFieldLabel: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                      AI System Prompt
                      <textarea
                        rows={5}
                        value={configDraft.aiSystemPrompt}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, aiSystemPrompt: event.target.value }))
                        }
                        className="mt-1 w-full resize-y rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                      AI Task Prompt
                      <textarea
                        rows={4}
                        value={configDraft.aiTaskPrompt}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, aiTaskPrompt: event.target.value }))
                        }
                        className="mt-1 w-full resize-y rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-black/70 md:col-span-2">
                      Common Format Template
                      <input
                        value={configDraft.commonFormatTemplate}
                        onChange={(event) =>
                          updateDraft((current) => ({ ...current, commonFormatTemplate: event.target.value }))
                        }
                        placeholder="Use placeholders like {{matter}}, {{date}}, {{title}}"
                        className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                      />
                    </label>
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <p className="text-sm font-semibold">Field Definitions</p>
                    <button
                      type="button"
                      onClick={addDraftField}
                      className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
                    >
                      Add Field
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    {configDraft.fields.map((field, index) => (
                      <div key={`${field.fieldKey}-${index}`} className="rounded-2xl border border-black/10 bg-[#f9fbfe] p-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                            Field Key
                            <input
                              value={field.fieldKey}
                              onChange={(event) =>
                                updateDraftField(index, (current) => ({ ...current, fieldKey: event.target.value }))
                              }
                              className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                            Field Label
                            <input
                              value={field.fieldLabel}
                              onChange={(event) =>
                                updateDraftField(index, (current) => ({ ...current, fieldLabel: event.target.value }))
                              }
                              className="mt-1 w-full rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-wide text-black/70">
                            Schema Type
                            <select
                              value={field.schemaType}
                              onChange={(event) =>
                                updateDraftField(index, (current) => ({
                                  ...current,
                                  schemaType: event.target.value as FieldSchemaType,
                                  itemSchemaType:
                                    event.target.value === "array" ? current.itemSchemaType ?? "string" : null,
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
                            Array Item Type
                            <select
                              value={field.itemSchemaType ?? "string"}
                              disabled={field.schemaType !== "array"}
                              onChange={(event) =>
                                updateDraftField(index, (current) => ({
                                  ...current,
                                  itemSchemaType: event.target.value as ArrayItemSchemaType,
                                }))
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
                            Prompt Description
                            <textarea
                              rows={3}
                              value={field.promptDescription}
                              onChange={(event) =>
                                updateDraftField(index, (current) => ({
                                  ...current,
                                  promptDescription: event.target.value,
                                }))
                              }
                              className="mt-1 w-full resize-y rounded-xl border border-black/15 px-2 py-1.5 text-sm font-normal normal-case"
                            />
                          </label>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 text-sm font-semibold text-black/80">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(event) =>
                                updateDraftField(index, (current) => ({ ...current, required: event.target.checked }))
                              }
                            />
                            Required
                          </label>

                          <button
                            type="button"
                            onClick={() => removeDraftField(index)}
                            className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            Remove Field
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </main>
      </div>

      {loading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/95 p-6 shadow-[0_30px_90px_-35px_rgba(15,23,42,0.6)]">
            <div className="flex items-center gap-3">
              <span className="h-6 w-6 rounded-full border-2 border-[#1e3f52]/30 border-t-[#1e3f52] animate-spin" />
              <p className="text-base font-semibold text-[#1e3f52]">Processing Request</p>
            </div>

            <p className="mt-3 text-sm text-black/70">{loadingMessages[loadingStepIndex]}</p>

            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#dce9f2]">
              <div className="h-full w-1/2 rounded-full bg-[#1e3f52] animate-pulse" />
            </div>

            <div className="mt-4 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#1e3f52] animate-bounce" />
              <span className="h-2 w-2 rounded-full bg-[#1e3f52] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 rounded-full bg-[#1e3f52] animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
