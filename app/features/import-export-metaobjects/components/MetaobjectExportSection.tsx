import React from "react";
import type { ExportResource } from "../types";

interface MetaobjectExportSectionProps {
  fileValues: boolean;
  setIncludeFieldValues: (value: boolean) => void;
  includeCommandColumn: boolean;
  setIncludeCommandColumn: (value: boolean) => void;
  handleExport: (resource: ExportResource, includeFieldValues?: boolean) => Promise<void>;
  activeExport: ExportResource | null;
}

export function MetaobjectExportSection({
  fileValues,
  setIncludeFieldValues,
  includeCommandColumn,
  setIncludeCommandColumn,
  handleExport,
  activeExport,
}: MetaobjectExportSectionProps) {
  return (
    <s-section heading="Metaobject Export">
      <s-stack gap="small">
        <s-text>Export all metaobjects to CSV, with optional import-friendly columns.</s-text>

        <s-checkbox
          label="Include metaobject field values"
          checked={fileValues}
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
          onClick={() => handleExport("metaobjects", fileValues)}
          disabled={activeExport !== null}
        >
          {activeExport === "metaobjects" ? "Exporting..." : "Export Metaobjects"}
        </s-button>
      </s-stack>
    </s-section>
  );
}
