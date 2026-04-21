import { useState } from "react";
import type { ExportResource } from "./types";
import { DOWNLOAD_PATH } from "./constants";
import { parseMetaobjectFilename } from "./utils";

interface UseHandleExportOptions {
  onError: (error: string | null) => void;
  activeExport: ExportResource | null;
  setActiveExport: (resource: ExportResource | null) => void;
  includeCommandColumn?: boolean;
}

export const useHandleExport = ({
  onError,
  activeExport,
  setActiveExport,
  includeCommandColumn = false,
}: UseHandleExportOptions) => {
  const handleExport = async (
    resource: ExportResource,
    includeMetaobjectFieldValues = false,
  ) => {
    setActiveExport(resource);
    onError(null);

    try {
      const params = new URLSearchParams();
      params.set("resource", resource);
      if (resource === "metaobjects" && includeMetaobjectFieldValues) {
        params.set("includeFieldValues", "1");
      }
      if (resource === "metaobjects" && includeCommandColumn) {
        params.set("includeCommandColumn", "1");
      }

      const response = await fetch(
        `${DOWNLOAD_PATH}${params.toString() ? `?${params.toString()}` : ""}`,
        {
          method: "GET",
          headers: {
            Accept: "text/csv",
          },
        },
      );

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to export metaobjects");
      }

      const blob = await response.blob();
      const filename = parseMetaobjectFilename(response.headers.get("Content-Disposition"));
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Export failed");
    } finally {
      setActiveExport(null);
    }
  };

  return { handleExport };
};
