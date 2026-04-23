import React, { useRef, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { MetaobjectImportActionData } from "../types";

interface MetaobjectImportSectionProps {
  activeExport: string | null;
  importIntent: string;
}

export function MetaobjectImportSection({
  activeExport,
  importIntent,
}: MetaobjectImportSectionProps) {
  const importFetcher = useFetcher<MetaobjectImportActionData>();
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const previousImportFetcherState = useRef(importFetcher.state);
  const dropZoneRef = useRef<any>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const importResult = importFetcher.data;

  useEffect(() => {
    const importFinished =
      previousImportFetcherState.current !== "idle" && importFetcher.state === "idle";

    if (importFinished && csvFileInputRef.current) {
      csvFileInputRef.current.value = "";
      setSelectedFileName(null);
    }

    previousImportFetcherState.current = importFetcher.state;
  }, [importFetcher.state]);

  useEffect(() => {
    const dropZone = dropZoneRef.current;
    if (!dropZone) return;

    const handleChange = () => {
      if (dropZone.files && dropZone.files.length > 0) {
        setSelectedFileName(dropZone.files[0].name);
      }
    };

    dropZone.addEventListener("change", handleChange);
    return () => dropZone.removeEventListener("change", handleChange);
  }, []);

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

  return (
    <s-section heading="Metaobject Import (CSV)">
      <s-stack gap="small">
        <s-text color="subdued">
          Required columns: Handle, Definition: Handle, Command, Field, Value.
        </s-text>
        <s-text color="subdued">
          Supported Command values: NEW, MERGE, UPDATE, REPLACE, DELETE, IGNORE. Command is
          required on every row.
        </s-text>

        <importFetcher.Form method="post" encType="multipart/form-data">
          <s-stack gap="small">
            <input type="hidden" name="intent" value={importIntent} />
            <s-drop-zone
              ref={dropZoneRef}
              name="csvFile"
              label={selectedFileName ? `✓ ${selectedFileName}` : "Drag CSV file here or click to upload"}
              accept=".csv,text/csv"
              required
              disabled={importFetcher.state !== "idle" || activeExport !== null}
            />
            <s-button
              type="submit"
              disabled={importFetcher.state !== "idle" || activeExport !== null}
            >
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
              Updated: {importResult.summary.updatedCount} | Created:{" "}
              {importResult.summary.createdCount} | Failed: {importResult.summary.failedCount}
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
  );
}
