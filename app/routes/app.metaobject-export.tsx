import React, { useState } from "react";
import { type LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

const DOWNLOAD_PATH = "/app/metaobject-export-download";
type ExportResource = "products" | "collections" | "articles" | "pages" | "metaobjects";
type HandleExportResource = Exclude<ExportResource, "metaobjects">;

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

function parseFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "metaobjects-export.csv";
  const match = contentDisposition.match(/filename="?([^\"]+)"?/i);
  return match?.[1] ?? "metaobjects-export.csv";
}

export default function MetaobjectExport() {
  const [activeExport, setActiveExport] = useState<ExportResource | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [includeFieldValues, setIncludeFieldValues] = useState(false);

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
