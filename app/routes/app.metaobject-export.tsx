import React, { useState } from "react";
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
  fields: CsvMetaobjectField[];
};

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
  "Field",
  "Value",
] as const;

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
    headerMap.set(header.trim(), index);
  });

  const missingHeaders = REQUIRED_METAOBJECT_IMPORT_HEADERS.filter(
    (header) => !headerMap.has(header),
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

  const handleIndex = headerMap.get("Handle")!;
  const definitionHandleIndex = headerMap.get("Definition: Handle")!;
  const fieldIndex = headerMap.get("Field")!;
  const valueIndex = headerMap.get("Value")!;

  const validationErrors: string[] = [];
  const groupedEntries = new Map<
    string,
    { handle: string; definitionHandle: string; fieldMap: Map<string, string> }
  >();

  dataRows.forEach((row, rowIndex) => {
    const csvRowNumber = rowIndex + 2;
    const handle = (row[handleIndex] ?? "").trim();
    const definitionHandle = (row[definitionHandleIndex] ?? "").trim();
    const field = (row[fieldIndex] ?? "").trim();
    const value = (row[valueIndex] ?? "").trim();

    if (!handle) {
      validationErrors.push(`Row ${csvRowNumber}: Handle is required.`);
    }

    if (!definitionHandle) {
      validationErrors.push(`Row ${csvRowNumber}: Definition: Handle is required.`);
    }

    if (!field) {
      validationErrors.push(`Row ${csvRowNumber}: Field is required.`);
    }

    if (!handle || !definitionHandle || !field) {
      return;
    }

    const entryKey = `${definitionHandle}::${handle}`;
    const existing = groupedEntries.get(entryKey);

    if (existing) {
      existing.fieldMap.set(field, value);
      return;
    }

    groupedEntries.set(entryKey, {
      handle,
      definitionHandle,
      fieldMap: new Map([[field, value]]),
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

  for (const entry of entries) {
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
      const existingMetaobject = lookupJson.data?.metaobjectByHandle;

      if (existingMetaobject?.id) {
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
              id: existingMetaobject.id,
              metaobject: {
                fields: entry.fields,
              },
            },
          },
        );

        const updateJson = await updateRes.json();
        const updateErrors = updateJson.data?.metaobjectUpdate?.userErrors ?? [];

        if (updateErrors.length > 0) {
          summary.failedCount += 1;
          errorLogs.push({
            definitionHandle: entry.definitionHandle,
            handle: entry.handle,
            message: updateErrors[0].message,
          });
          continue;
        }

        summary.updatedCount += 1;
        continue;
      }

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
        summary.failedCount += 1;
        errorLogs.push({
          definitionHandle: entry.definitionHandle,
          handle: entry.handle,
          message: createErrors[0].message,
        });
        continue;
      }

      summary.createdCount += 1;
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
  const importFetcher = useFetcher<MetaobjectImportActionData>();

  const importResult = importFetcher.data;

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
    <div style={{ padding: "1rem", maxWidth: "700px" }}>
      <h1>Handle Export</h1>
      <p>
        Export separate CSV lists of handles from products, collections, blog posts (with blog handle), and pages.
      </p>

      <div style={{ display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {EXPORT_OPTIONS.map((option) => (
          <button
            key={option.resource}
            type="button"
            onClick={() => handleExport(option.resource)}
            disabled={activeExport !== null}
          >
            {activeExport === option.resource ? "Exporting..." : option.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #ddd" }}>
        <h2 style={{ marginTop: 0 }}>Metaobject Export</h2>
        <p>Export all metaobjects to CSV, with an optional column-level export of field values.</p>

        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          <input
            type="checkbox"
            checked={includeFieldValues}
            onChange={(event) => setIncludeFieldValues(event.currentTarget.checked)}
            disabled={activeExport !== null}
            style={{ marginRight: "0.5rem" }}
          />
          Include metaobject field values
        </label>

        <button
          type="button"
          onClick={() => handleExport("metaobjects", includeFieldValues)}
          disabled={activeExport !== null}
        >
          {activeExport === "metaobjects" ? "Exporting..." : "Export Metaobjects"}
        </button>
      </div>

      <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #ddd" }}>
        <h2 style={{ marginTop: 0 }}>Metaobject Import (CSV)</h2>
        <p style={{ marginBottom: "0.5rem" }}>
          Required columns: Handle, Definition: Handle, Field, Value. Any optional
          "Definition: Name" or "Command" columns are ignored.
        </p>
        <p style={{ marginTop: 0 }}>
          Import uses merge behavior: only fields listed in your CSV are updated.
          Other existing metaobject fields remain unchanged.
        </p>

        <importFetcher.Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: "0.75rem", maxWidth: "500px" }}>
          <input type="hidden" name="intent" value={IMPORT_INTENT} />
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>CSV file</span>
            <input
              name="csvFile"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={importFetcher.state !== "idle" || activeExport !== null}
            />
          </label>
          <button type="submit" disabled={importFetcher.state !== "idle" || activeExport !== null}>
            {importFetcher.state !== "idle" ? "Importing..." : "Import Metaobjects"}
          </button>
        </importFetcher.Form>

        {importFetcher.state !== "idle" ? (
          <div style={{ marginTop: "0.75rem" }}>
            <p style={{ marginBottom: "0.4rem" }}>Importing metaobjects. This may take a while.</p>
            <progress style={{ width: "100%", maxWidth: "500px" }} />
          </div>
        ) : null}

        {importResult?.summary ? (
          <div style={{ marginTop: "0.9rem" }}>
            <p style={{ margin: 0 }}>
              Total metaobjects in CSV: {importResult.summary.totalMetaobjects}
            </p>
            <p style={{ margin: "0.25rem 0 0" }}>
              Updated: {importResult.summary.updatedCount} | Created: {importResult.summary.createdCount} | Failed: {importResult.summary.failedCount}
            </p>
          </div>
        ) : null}

        {importResult?.error ? (
          <p style={{ color: "#b00020", marginTop: "0.75rem" }}>{importResult.error}</p>
        ) : null}

        {importResult?.validationErrors && importResult.validationErrors.length > 0 ? (
          <ul style={{ color: "#b00020", marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
            {importResult.validationErrors.map((validationError) => (
              <li key={validationError}>{validationError}</li>
            ))}
          </ul>
        ) : null}

        {importResult?.success && !importResult.error ? (
          <p style={{ color: "#0b7a35", marginTop: "0.75rem" }}>
            Metaobject import completed successfully.
          </p>
        ) : null}

        {importResult?.errorLogs && importResult.errorLogs.length > 0 ? (
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={downloadErrorLog}>
              Download Error Log (CSV)
            </button>
          </div>
        ) : null}
      </div>

      {activeExport ? (
        <div style={{ marginTop: "1rem" }}>
          <p>Preparing CSV export. This can take a while for large catalogs.</p>
          <progress style={{ width: "100%" }} />
        </div>
      ) : null}

      {errorMessage ? <p style={{ color: "#b00020", marginTop: "0.75rem" }}>{errorMessage}</p> : null}
    </div>
  );
}
