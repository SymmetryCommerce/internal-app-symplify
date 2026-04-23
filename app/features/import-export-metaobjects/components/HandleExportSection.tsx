import type { ExportResource } from "../types";
import { EXPORT_OPTIONS } from "../constants";

interface HandleExportSectionProps {
  handleExport: (resource: ExportResource) => Promise<void>;
  activeExport: ExportResource | null;
}

export function HandleExportSection({
  handleExport,
  activeExport,
}: HandleExportSectionProps) {
  return (
    <s-section heading="Handle Export">
      <s-stack gap="base">
        <s-text>
          Export separate CSV lists of handles from products, collections, blog posts
          (with blog handle), and pages.
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
  );
}
