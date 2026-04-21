import type { HandleExportResource, MetaobjectImportCommand } from "./types";

export const DOWNLOAD_PATH = "/app/metaobject-import-export";

export const REQUIRED_METAOBJECT_IMPORT_HEADERS = [
  "Handle",
  "Definition: Handle",
  "Command",
  "Field",
  "Value",
] as const;

export const ALLOWED_METAOBJECT_COMMANDS: MetaobjectImportCommand[] = [
  "NEW",
  "MERGE",
  "UPDATE",
  "REPLACE",
  "DELETE",
  "IGNORE",
];

export const IMPORT_INTENT = "importMetaobjectsCsv";

export const EXPORT_OPTIONS: Array<{ resource: HandleExportResource; label: string }> = [
  { resource: "products", label: "Export Product Handles" },
  { resource: "collections", label: "Export Collection Handles" },
  { resource: "articles", label: "Export Blog Post Handles" },
  { resource: "pages", label: "Export Page Handles" },
];
