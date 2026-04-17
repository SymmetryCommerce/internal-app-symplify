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
    <s-page heading="Export All Metaobjects">
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
          <s-text>Export all metaobjects to CSV, with an optional column-level export of field values.</s-text>

          <s-checkbox
            label="Include metaobject field values"
            checked={includeFieldValues}
            onChange={(event) => setIncludeFieldValues(event.currentTarget.checked)}
            disabled={activeExport !== null}
          />

          <s-button
            onClick={() => handleExport("metaobjects", includeFieldValues)}
            disabled={activeExport !== null}
          >
            {activeExport === "metaobjects" ? "Exporting..." : "Export Metaobjects"}
          </s-button>
        </s-stack>
      </s-section>

      {activeExport ? (
        <s-stack>
          <s-text>Preparing CSV export. This can take a while for large catalogs.</s-text>
          <progress style={{ width: "100%" }} />
        </s-stack>
      ) : null}

      {errorMessage ? <s-text tone="critical">{errorMessage}</s-text> : null}
    </s-page>
  );
}
