import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  validateMetaobjectImportCsvRows,
  processMetaobjectImport,
  IMPORT_INTENT,
  type MetaobjectImportActionData,
  ExportResource,
  useHandleExport,
  HandleExportSection,
  MetaobjectExportSection,
  MetaobjectImportSection,
  handleExportLoader,
  isExportResource,
} from "../features/import-export-metaobjects";
import { parseCsvContent } from "app/shared/utils/csvParser";
import { useState } from "react";
import { CollapsibleFeatureInfo } from "app/shared";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Handle export downloads
  if (request.method === "GET") {
    const requestUrl = new URL(request.url);
    const resourceParam = requestUrl.searchParams.get("resource");
    
    // If there's a resource param, this is an export request
    if (resourceParam) {
      const { admin } = await authenticate.admin(request);
      const resource = isExportResource(resourceParam) ? resourceParam : "metaobjects";
      const includeFieldValues = requestUrl.searchParams.get("includeFieldValues") === "1";
      const includeCommandColumn = requestUrl.searchParams.get("includeCommandColumn") === "1";
      
      return handleExportLoader(admin, resource, includeFieldValues, includeCommandColumn);
    }
  }
  
  // Normal page load
  await authenticate.admin(request);
  return null;
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
  const { summary, errorLogs } = await processMetaobjectImport({
    admin,
    entries,
  });

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

export default function MetaobjectImportExportPage() {
  const [activeExport, setActiveExport] = useState<ExportResource | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [includeFieldValues, setIncludeFieldValues] = useState(false);
  const [includeCommandColumn, setIncludeCommandColumn] = useState(false);

  const { handleExport } = useHandleExport({
    onError: setErrorMessage,
    activeExport,
    setActiveExport,
    includeCommandColumn,
  });

  return (
    <s-page heading="Metaobject Import and Export">
      <CollapsibleFeatureInfo
        slot="aside"
        title="Import or Export page"
        summary="Useful for moving catalog and metaobject handle data between systems and running controlled metaobject CSV imports."
      >
        <s-text>Core features:</s-text>
        <s-unordered-list>
          <s-list-item>Export product, collection, article, and page handles to CSV.</s-list-item>
          <s-list-item>Export metaobjects to CSV with optional field values and import command column.</s-list-item>
          <s-list-item>Import metaobjects via CSV using commands: NEW, MERGE, UPDATE, REPLACE, DELETE, IGNORE.</s-list-item>
          <s-list-item>Get import totals and download error logs for failed rows.</s-list-item>
        </s-unordered-list>
        <s-text>How to use:</s-text>
        <s-ordered-list>
          <s-list-item>Use export first to generate a template and understand expected structure.</s-list-item>
          <s-list-item>Edit CSV with desired command behavior per handle.</s-list-item>
          <s-list-item>Upload CSV in Metaobject Import and run import.</s-list-item>
          <s-list-item>Download error log CSV if any rows fail, then correct and rerun.</s-list-item>
        </s-ordered-list>
      </CollapsibleFeatureInfo>

      <HandleExportSection
        handleExport={handleExport}
        activeExport={activeExport}
      />

      <MetaobjectExportSection
        fileValues={includeFieldValues}
        setIncludeFieldValues={setIncludeFieldValues}
        includeCommandColumn={includeCommandColumn}
        setIncludeCommandColumn={setIncludeCommandColumn}
        handleExport={handleExport}
        activeExport={activeExport}
      />

      <MetaobjectImportSection
        activeExport={activeExport}
        importIntent={IMPORT_INTENT}
      />

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