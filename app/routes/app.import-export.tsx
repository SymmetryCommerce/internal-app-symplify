import React, { useEffect, useRef, useState } from "react";
import {
  useFetcher,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { authenticate } from "../shopify.server";

const DOWNLOAD_PATH = "/app/metaobject-export-download";
type ExportResource = "products" | "collections" | "articles" | "pages" | "metaobjects";
type HandleExportResource = Exclude<ExportResource, "metaobjects">;

type CsvMetaobjectField = {
  key: string;
  value: string;
};

type CsvMetaobjectEntry = {
  handle: string;
  definitionHandle: string;
  command: MetaobjectImportCommand;
  fields: CsvMetaobjectField[];
};

type MetaobjectImportCommand =
  | "NEW"
  | "MERGE"
  | "UPDATE"
  | "REPLACE"
  | "DELETE"
  | "IGNORE";

type ImportErrorLog = {
  definitionHandle: string;
  handle: string;
  message: string;
};

type ImportSummary = {
  totalMetaobjects: number;
  updatedCount: number;
  createdCount: number;
  failedCount: number;
};

type MetaobjectImportActionData = {
  success: boolean;
  error?: string;
  validationErrors?: string[];
  summary?: ImportSummary;
  errorLogs?: ImportErrorLog[];
};

const REQUIRED_METAOBJECT_IMPORT_HEADERS = [
  "Handle",
  "Definition: Handle",
  "Command",
  "Field",
  "Value",
] as const;

const normalizeHeader = (header: string) => header.trim().toLowerCase();

const ALLOWED_METAOBJECT_COMMANDS: MetaobjectImportCommand[] = [
  "NEW",
  "MERGE",
  "UPDATE",
  "REPLACE",
  "DELETE",
  "IGNORE",
];

const IMPORT_INTENT = "importMetaobjectsCsv";

const EXPORT_OPTIONS: Array<{ resource: HandleExportResource; label: string }> = [
  { resource: "products", label: "Export Product Handles" },
  { resource: "collections", label: "Export Collection Handles" },
  { resource: "articles", label: "Export Blog Post Handles" },
  { resource: "pages", label: "Export Page Handles" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const parseCsvContent = (csvContent: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows
    .map((currentRow) => currentRow.map((currentCell) => currentCell.trim()))
    .filter((currentRow) => currentRow.some((currentCell) => currentCell.length > 0));
};

const validateMetaobjectImportCsvRows = (
  csvRows: string[][],
):
  | { ok: true; entries: CsvMetaobjectEntry[] }
  | { ok: false; error: string; validationErrors?: string[] } => {
  if (csvRows.length === 0) {
    return { ok: false, error: "CSV file is empty." };
  }

  const [headerRow, ...dataRows] = csvRows;
  const headerMap = new Map<string, number>();
  headerRow.forEach((header, index) => {
    headerMap.set(normalizeHeader(header), index);
  });

  const missingHeaders = REQUIRED_METAOBJECT_IMPORT_HEADERS.filter(
    (header) => !headerMap.has(normalizeHeader(header)),
  );

  if (missingHeaders.length > 0) {
    return {
      ok: false,
      error: `CSV is missing required header(s): ${missingHeaders.join(", ")}. Expected headers: ${REQUIRED_METAOBJECT_IMPORT_HEADERS.join(", ")}.`,
    };
  }

  if (dataRows.length === 0) {
    return { ok: false, error: "CSV has headers but no data rows." };
  }

  const handleIndex = headerMap.get(normalizeHeader("Handle"))!;
  const definitionHandleIndex = headerMap.get(normalizeHeader("Definition: Handle"))!;
  const commandIndex = headerMap.get(normalizeHeader("Command"))!;
  const fieldIndex = headerMap.get(normalizeHeader("Field"))!;
  const valueIndex = headerMap.get(normalizeHeader("Value"))!;

  const validationErrors: string[] = [];
  const groupedEntries = new Map<
    string,
    {
      handle: string;
      definitionHandle: string;
      command: MetaobjectImportCommand;
      fieldMap: Map<string, string>;
    }
  >();

  dataRows.forEach((row, rowIndex) => {
    const csvRowNumber = rowIndex + 2;
    const handle = (row[handleIndex] ?? "").trim();
    const definitionHandle = (row[definitionHandleIndex] ?? "").trim();
    const commandRaw = (row[commandIndex] ?? "").trim().toUpperCase();
    const command = commandRaw as MetaobjectImportCommand;
    const field = (row[fieldIndex] ?? "").trim();
    const value = (row[valueIndex] ?? "").trim();

    if (!handle) {
      validationErrors.push(`Row ${csvRowNumber}: Handle is required.`);
    }

    if (!definitionHandle) {
      validationErrors.push(`Row ${csvRowNumber}: Definition: Handle is required.`);
    }

    if (!commandRaw) {
      validationErrors.push(`Row ${csvRowNumber}: Command is required.`);
    }

    if (commandRaw && !ALLOWED_METAOBJECT_COMMANDS.includes(command)) {
      validationErrors.push(
        `Row ${csvRowNumber}: Command '${commandRaw}' is invalid. Allowed values: ${ALLOWED_METAOBJECT_COMMANDS.join(", ")}.`,
      );
    }

    const requiresField = command !== "DELETE" && command !== "IGNORE";

    if (requiresField && !field) {
      validationErrors.push(`Row ${csvRowNumber}: Field is required.`);
    }

    if (!handle || !definitionHandle || !ALLOWED_METAOBJECT_COMMANDS.includes(command)) {
      return;
    }

    if (requiresField && !field) {
      return;
    }

    const entryKey = `${definitionHandle}::${handle}`;
    const existing = groupedEntries.get(entryKey);

    if (existing) {
      if (existing.command !== command) {
        validationErrors.push(
          `Row ${csvRowNumber}: Command '${command}' conflicts with previous rows for Handle '${handle}' and Definition: Handle '${definitionHandle}' (currently '${existing.command}').`,
        );
        return;
      }

      if (requiresField) {
        existing.fieldMap.set(field, value);
      }
      return;
    }

    groupedEntries.set(entryKey, {
      handle,
      definitionHandle,
      command,
      fieldMap: requiresField ? new Map([[field, value]]) : new Map(),
    });
  });

  if (validationErrors.length > 0) {
    return {
      ok: false,
      error: "CSV validation failed. Fix the issues listed below and try again.",
      validationErrors,
    };
  }

  const entries: CsvMetaobjectEntry[] = Array.from(groupedEntries.values()).map((entry) => ({
    handle: entry.handle,
    definitionHandle: entry.definitionHandle,
    command: entry.command,
    fields: Array.from(entry.fieldMap.entries()).map(([key, value]) => ({ key, value })),
  }));

  if (entries.length === 0) {
    return { ok: false, error: "CSV contains no valid rows to import." };
  }

  return { ok: true, entries };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<MetaobjectImportActionData> => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = (formData.get("intent") as string) ?? "";

  if (intent !== IMPORT_INTENT) {
    return {
      success: false,
      error: "Unsupported action intent.",
    };
  }

  const csvFile = formData.get("csvFile");

  if (!(csvFile instanceof File)) {
    return {
      success: false,
      error:
        "Please upload a CSV file containing Handle, Definition: Handle, Field, and Value columns.",
    };
  }

  const csvText = await csvFile.text();
  const parsedRows = parseCsvContent(csvText);
  const validationResult = validateMetaobjectImportCsvRows(parsedRows);

  if (!validationResult.ok) {
    return {
      success: false,
      error: validationResult.error,
      validationErrors: validationResult.validationErrors,
    };
  }

  const entries = validationResult.entries;
  const definitionHandles = Array.from(new Set(entries.map((entry) => entry.definitionHandle)));
  const existingDefinitions = new Set<string>();
  const missingDefinitions = new Set<string>();
  const errorLogs: ImportErrorLog[] = [];

  for (const definitionHandle of definitionHandles) {
    try {
      const definitionRes = await admin.graphql(
        `
        query MetaobjectDefinitionByType($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            id
            type
          }
        }
        `,
        { variables: { type: definitionHandle } },
      );

      const definitionJson = await definitionRes.json();
      const definitionNode = definitionJson.data?.metaobjectDefinitionByType;

      if (definitionNode?.id) {
        existingDefinitions.add(definitionHandle);
      } else {
        missingDefinitions.add(definitionHandle);
      }
    } catch (error) {
      missingDefinitions.add(definitionHandle);
      errorLogs.push({
        definitionHandle,
        handle: "*",
        message:
          error instanceof Error
            ? `Failed to validate definition: ${error.message}`
            : "Failed to validate definition.",
      });
    }
  }

  const summary: ImportSummary = {
    totalMetaobjects: entries.length,
    updatedCount: 0,
    createdCount: 0,
    failedCount: 0,
  };

  const findMetaobjectByHandle = async (entry: CsvMetaobjectEntry) => {
    const lookupRes = await admin.graphql(
      `
      query GetMetaobjectByHandle($handle: MetaobjectHandleInput!) {
        metaobjectByHandle(handle: $handle) {
          id
          handle
        }
      }
      `,
      {
        variables: {
          handle: {
            type: entry.definitionHandle,
            handle: entry.handle,
          },
        },
      },
    );

    const lookupJson = await lookupRes.json();
    return lookupJson.data?.metaobjectByHandle as { id: string; handle: string } | null;
  };

  const createMetaobject = async (entry: CsvMetaobjectEntry) => {
    const createRes = await admin.graphql(
      `
      mutation CreateMetaobject($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
      `,
      {
        variables: {
          metaobject: {
            type: entry.definitionHandle,
            handle: entry.handle,
            fields: entry.fields,
          },
        },
      },
    );

    const createJson = await createRes.json();
    const createErrors = createJson.data?.metaobjectCreate?.userErrors ?? [];

    if (createErrors.length > 0) {
      throw new Error(createErrors[0].message);
    }
  };

  const updateMetaobject = async (entry: CsvMetaobjectEntry, id: string) => {
    const updateRes = await admin.graphql(
      `
      mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
      `,
      {
        variables: {
          id,
          metaobject: {
            fields: entry.fields,
          },
        },
      },
    );

    const updateJson = await updateRes.json();
    const updateErrors = updateJson.data?.metaobjectUpdate?.userErrors ?? [];

    if (updateErrors.length > 0) {
      throw new Error(updateErrors[0].message);
    }
  };

  const deleteMetaobject = async (id: string) => {
    const deleteRes = await admin.graphql(
      `
      mutation DeleteMetaobject($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors {
            field
            message
          }
        }
      }
      `,
      { variables: { id } },
    );

    const deleteJson = await deleteRes.json();
    const deleteErrors = deleteJson.data?.metaobjectDelete?.userErrors ?? [];

    if (deleteErrors.length > 0) {
      throw new Error(deleteErrors[0].message);
    }
  };

  for (const entry of entries) {
    if (entry.command === "IGNORE") {
      continue;
    }

    if (missingDefinitions.has(entry.definitionHandle) || !existingDefinitions.has(entry.definitionHandle)) {
      summary.failedCount += 1;
      errorLogs.push({
        definitionHandle: entry.definitionHandle,
        handle: entry.handle,
        message: `Metaobject definition '${entry.definitionHandle}' does not exist.`,
      });
      continue;
    }

    try {
      const existingMetaobject = await findMetaobjectByHandle(entry);

      if (entry.command === "NEW") {
        if (existingMetaobject?.id) {
          summary.failedCount += 1;
          errorLogs.push({
            definitionHandle: entry.definitionHandle,
            handle: entry.handle,
            message: "Metaobject already exists, so NEW command failed.",
          });
          continue;
        }

        await createMetaobject(entry);
        summary.createdCount += 1;
        continue;
      }

      if (entry.command === "MERGE") {
        if (existingMetaobject?.id) {
          await updateMetaobject(entry, existingMetaobject.id);
          summary.updatedCount += 1;
          continue;
        }

        await createMetaobject(entry);
        summary.createdCount += 1;
        continue;
      }

      if (entry.command === "UPDATE") {
        if (!existingMetaobject?.id) {
          summary.failedCount += 1;
          errorLogs.push({
            definitionHandle: entry.definitionHandle,
            handle: entry.handle,
            message: "Metaobject was not found, so UPDATE command failed.",
          });
          continue;
        }

        await updateMetaobject(entry, existingMetaobject.id);
        summary.updatedCount += 1;
        continue;
      }

      if (entry.command === "REPLACE") {
        if (existingMetaobject?.id) {
          await deleteMetaobject(existingMetaobject.id);
        }

        await createMetaobject(entry);
        summary.createdCount += 1;
        continue;
      }

      if (entry.command === "DELETE") {
        if (!existingMetaobject?.id) {
          summary.failedCount += 1;
          errorLogs.push({
            definitionHandle: entry.definitionHandle,
            handle: entry.handle,
            message: "Metaobject was not found, so DELETE command failed.",
          });
          continue;
        }

        await deleteMetaobject(existingMetaobject.id);
        summary.updatedCount += 1;
      }
    } catch (error) {
      summary.failedCount += 1;
      errorLogs.push({
        definitionHandle: entry.definitionHandle,
        handle: entry.handle,
        message: error instanceof Error ? error.message : "Unknown import error.",
      });
    }
  }

  return {
    success: summary.failedCount === 0,
    summary,
    errorLogs: errorLogs.length > 0 ? errorLogs : undefined,
    ...(summary.failedCount > 0
      ? {
          error:
            "Some metaobjects failed to import. Download the error log for details.",
        }
      : {}),
  };
};

function parseFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "metaobjects-export.csv";
  const match = contentDisposition.match(/filename="?([^\"]+)"?/i);
  return match?.[1] ?? "metaobjects-export.csv";
}

export default function MetaobjectExport() {
  const [activeExport, setActiveExport] = useState<ExportResource | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [includeFieldValues, setIncludeFieldValues] = useState(false);
  const [includeCommandColumn, setIncludeCommandColumn] = useState(false);
  const importFetcher = useFetcher<MetaobjectImportActionData>();
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const previousImportFetcherState = useRef(importFetcher.state);

  const importResult = importFetcher.data;

  useEffect(() => {
    const importFinished =
      previousImportFetcherState.current !== "idle" && importFetcher.state === "idle";

    if (importFinished && csvFileInputRef.current) {
      csvFileInputRef.current.value = "";
    }

    previousImportFetcherState.current = importFetcher.state;
  }, [importFetcher.state]);

  const downloadErrorLog = () => {
    const logs = importResult?.errorLogs;
    if (!logs || logs.length === 0) {
      return;
    }

    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const lines = [
      "Definition: Handle,Handle,Error",
      ...logs.map((log) =>
        [
          escapeCsv(log.definitionHandle),
          escapeCsv(log.handle),
          escapeCsv(log.message),
        ].join(","),
      ),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `metaobject-import-errors-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleExport = async (resource: ExportResource, includeMetaobjectFieldValues = false) => {
    setActiveExport(resource);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams();
      params.set("resource", resource);
      if (resource === "metaobjects" && includeMetaobjectFieldValues) {
        params.set("includeFieldValues", "1");
      }
      if (resource === "metaobjects" && includeCommandColumn) {
        params.set("includeCommandColumn", "1");
      }

      const response = await fetch(`${DOWNLOAD_PATH}${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "GET",
        headers: {
          Accept: "text/csv",
        },
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to export metaobjects");
      }

      const blob = await response.blob();
      const filename = parseFilename(response.headers.get("Content-Disposition"));
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setActiveExport(null);
    }
  };

  return (
    <s-page heading="Metaobject Import and Export">
      <s-section heading="Handle Export">
        <s-stack gap="base">
          <s-text>
            Export separate CSV lists of handles from products, collections, blog posts (with blog handle), and pages.
          </s-text>

          <s-stack direction="inline" gap="small">
            {EXPORT_OPTIONS.map((option) => (
              <s-button
                key={option.resource}
                type="button"
                onClick={() => handleExport(option.resource)}
                disabled={activeExport !== null}
              >
                {activeExport === option.resource ? "Exporting..." : option.label}
              </s-button>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Metaobject Export">
        <s-stack gap="small">
          <s-text>Export all metaobjects to CSV, with optional import-friendly columns.</s-text>

          <s-checkbox
            label="Include metaobject field values"
            checked={includeFieldValues}
            onChange={(event) => setIncludeFieldValues(event.currentTarget.checked)}
            disabled={activeExport !== null}
          />

          <s-checkbox
            label={'Include "Command" column (for importing)'}
            checked={includeCommandColumn}
            onChange={(event) => setIncludeCommandColumn(event.currentTarget.checked)}
            disabled={activeExport !== null}
          />

          <s-button
            type="button"
            onClick={() => handleExport("metaobjects", includeFieldValues)}
            disabled={activeExport !== null}
          >
            {activeExport === "metaobjects" ? "Exporting..." : "Export Metaobjects"}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Metaobject Import (CSV)">
        <s-stack gap="small">
          <s-text>Required columns: Handle, Definition: Handle, Command, Field, Value.</s-text>
          <s-text>Supported Command values: NEW, MERGE, UPDATE, REPLACE, DELETE, IGNORE. Command is required on every row.</s-text>

          <importFetcher.Form method="post" encType="multipart/form-data">
            <s-stack gap="small">
              <input type="hidden" name="intent" value={IMPORT_INTENT} />
              <label>
                <s-stack gap="none">
                  <s-text>CSV file</s-text>
                  <input
                    ref={csvFileInputRef}
                    name="csvFile"
                    type="file"
                    accept=".csv,text/csv"
                    required
                    disabled={importFetcher.state !== "idle" || activeExport !== null}
                  />
                </s-stack>
              </label>
              <s-button type="submit" disabled={importFetcher.state !== "idle" || activeExport !== null}>
                {importFetcher.state !== "idle" ? "Importing..." : "Import Metaobjects"}
              </s-button>
            </s-stack>
          </importFetcher.Form>

          {importFetcher.state !== "idle" ? (
            <s-stack gap="none">
              <s-text>Importing metaobjects. This may take a while.</s-text>
              <progress style={{ width: "100%" }} />
            </s-stack>
          ) : null}

          {importResult?.summary ? (
            <s-stack gap="none">
              <s-text>Total metaobjects in CSV: {importResult.summary.totalMetaobjects}</s-text>
              <s-text>
                Updated: {importResult.summary.updatedCount} | Created: {importResult.summary.createdCount} | Failed: {importResult.summary.failedCount}
              </s-text>
            </s-stack>
          ) : null}

          {importResult?.error ? <s-text tone="critical">{importResult.error}</s-text> : null}

          {importResult?.validationErrors && importResult.validationErrors.length > 0 ? (
            <s-stack gap="none">
              {importResult.validationErrors.map((validationError) => (
                <s-text key={validationError} tone="critical">
                  {validationError}
                </s-text>
              ))}
            </s-stack>
          ) : null}

          {importResult?.success && !importResult.error ? (
            <s-text>Metaobject import completed successfully.</s-text>
          ) : null}

          {importResult?.errorLogs && importResult.errorLogs.length > 0 ? (
            <s-button type="button" onClick={downloadErrorLog}>
              Download Error Log (CSV)
            </s-button>
          ) : null}
        </s-stack>
      </s-section>

      {activeExport ? (
        <s-stack gap="none">
          <s-text>Preparing CSV export. This can take a while for large catalogs.</s-text>
          <progress style={{ width: "100%" }} />
        </s-stack>
      ) : null}

      {errorMessage ? <s-text tone="critical">{errorMessage}</s-text> : null}
    </s-page>
  );
}
