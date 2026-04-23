/**
 * Export download loader
 * Handles CSV generation and file download responses
 */

import type { ExportResourceType } from "../types";
import {
  fetchAllDefinitionEdges,
  fetchAllMetaobjectsByType,
  fetchAllProductHandles,
  fetchAllCollectionHandles,
  fetchAllArticleHandlesWithBlogs,
  fetchAllPageHandles,
} from "./queries";

type AdminClient = any; // TODO: Replace with proper Shopify Admin API type

function csvEscape(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function buildHandleCsv(headers: string[], rows: string[][]) {
  const headerRow = headers.map(csvEscape).join(",");
  const dataRows = rows.map((row) => row.map(csvEscape).join(","));
  return [headerRow, ...dataRows].join("\n");
}

function createCsvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function getDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function isExportResource(value: string | null): value is ExportResourceType {
  return (
    value === "metaobjects" ||
    value === "products" ||
    value === "collections" ||
    value === "articles" ||
    value === "pages"
  );
}

export async function handleExportLoader(
  admin: AdminClient,
  resource: ExportResourceType,
  includeFieldValues: boolean,
  includeCommandColumn: boolean
): Promise<Response> {
  if (resource === "products") {
    const handles = await fetchAllProductHandles(admin);
    const csv = buildHandleCsv(["handle"], handles.map((handle) => [handle]));
    const filename = `product-handles-export-${getDateString()}.csv`;
    return createCsvResponse(csv, filename);
  }

  if (resource === "collections") {
    const handles = await fetchAllCollectionHandles(admin);
    const csv = buildHandleCsv(["handle"], handles.map((handle) => [handle]));
    const filename = `collection-handles-export-${getDateString()}.csv`;
    return createCsvResponse(csv, filename);
  }

  if (resource === "articles") {
    const entries = await fetchAllArticleHandlesWithBlogs(admin);
    const csv = buildHandleCsv(
      ["Blog: Handle", "Handle"],
      entries.map((entry) => [entry.blogHandle, entry.handle])
    );
    const filename = `blog-post-handles-export-${getDateString()}.csv`;
    return createCsvResponse(csv, filename);
  }

  if (resource === "pages") {
    const handles = await fetchAllPageHandles(admin);
    const csv = buildHandleCsv(["handle"], handles.map((handle) => [handle]));
    const filename = `page-handles-export-${getDateString()}.csv`;
    return createCsvResponse(csv, filename);
  }

  // Handle metaobjects (default)
  const definitionEdges = await fetchAllDefinitionEdges(admin);
  const rows: string[] = [];

  for (const { node: definition } of definitionEdges) {
    const entries = await fetchAllMetaobjectsByType(admin, definition.type, includeFieldValues);

    for (const entry of entries) {
      if (includeFieldValues) {
        const fields = entry.fields ?? [];

        if (fields.length === 0) {
          rows.push(
            [
              entry.handle,
              definition.type,
              ...(includeCommandColumn ? ["MERGE"] : []),
              definition.name,
              "",
              "",
            ]
              .map(csvEscape)
              .join(",")
          );
          continue;
        }

        for (const field of fields) {
          rows.push(
            [
              entry.handle,
              definition.type,
              ...(includeCommandColumn ? ["MERGE"] : []),
              definition.name,
              field.key,
              field.value ?? "",
            ]
              .map(csvEscape)
              .join(",")
          );
        }
      } else {
        rows.push(
          [
            entry.handle,
            definition.type,
            ...(includeCommandColumn ? ["MERGE"] : []),
            definition.name,
            "",
            "",
          ]
            .map(csvEscape)
            .join(",")
        );
      }
    }
  }

  const headerValues = [
    "Handle",
    "Definition: Handle",
    ...(includeCommandColumn ? ["Command"] : []),
    "Definition: Name",
    "Field",
    "Value",
  ];
  const headerRow = headerValues.map(csvEscape).join(",");

  const csv = [headerRow, ...rows].join("\n");
  const filename = `metaobjects-export-${getDateString()}.csv`;

  return createCsvResponse(csv, filename);
}

export { isExportResource };
