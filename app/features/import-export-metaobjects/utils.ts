import type { CsvMetaobjectEntry, MetaobjectImportCommand } from "./types";
import {
  REQUIRED_METAOBJECT_IMPORT_HEADERS,
  ALLOWED_METAOBJECT_COMMANDS,
} from "./constants";
import { normalizeHeader } from "../../shared/utils/csvParser";

type ValidationResult =
  | { ok: true; entries: CsvMetaobjectEntry[] }
  | { ok: false; error: string; validationErrors?: string[] };

export const parseMetaobjectFilename = (contentDisposition: string | null): string => {
  if (!contentDisposition) return "metaobjects-export.csv";
  const match = contentDisposition.match(/filename="?([^\"]+)"?/i);
  return match?.[1] ?? "metaobjects-export.csv";
};

export const validateMetaobjectImportCsvRows = (
  csvRows: string[][],
): ValidationResult => {
  if (csvRows.length === 0) {
    return { ok: false, error: "CSV file is empty." };
  }

  const [headerRow, ...dataRows] = csvRows;
  const headerMap = new Map<string, number>();
  headerRow.forEach((header, index) => {
    headerMap.set(normalizeHeader(header), index);
  });

  const missingHeaders = REQUIRED_METAOBJECT_IMPORT_HEADERS.filter(
    (header) => !headerMap.has(normalizeHeader(header)),
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

  const handleIndex = headerMap.get(normalizeHeader("Handle"))!;
  const definitionHandleIndex = headerMap.get(normalizeHeader("Definition: Handle"))!;
  const commandIndex = headerMap.get(normalizeHeader("Command"))!;
  const fieldIndex = headerMap.get(normalizeHeader("Field"))!;
  const valueIndex = headerMap.get(normalizeHeader("Value"))!;

  const validationErrors: string[] = [];
  const groupedEntries = new Map<
    string,
    {
      handle: string;
      definitionHandle: string;
      command: MetaobjectImportCommand;
      fieldMap: Map<string, string>;
    }
  >();

  dataRows.forEach((row, rowIndex) => {
    const csvRowNumber = rowIndex + 2;
    const handle = (row[handleIndex] ?? "").trim();
    const definitionHandle = (row[definitionHandleIndex] ?? "").trim();
    const commandRaw = (row[commandIndex] ?? "").trim().toUpperCase();
    const command = commandRaw as MetaobjectImportCommand;
    const field = (row[fieldIndex] ?? "").trim();
    const value = (row[valueIndex] ?? "").trim();

    if (!handle) {
      validationErrors.push(`Row ${csvRowNumber}: Handle is required.`);
    }

    if (!definitionHandle) {
      validationErrors.push(`Row ${csvRowNumber}: Definition: Handle is required.`);
    }

    if (!commandRaw) {
      validationErrors.push(`Row ${csvRowNumber}: Command is required.`);
    }

    if (commandRaw && !ALLOWED_METAOBJECT_COMMANDS.includes(command)) {
      validationErrors.push(
        `Row ${csvRowNumber}: Command '${commandRaw}' is invalid. Allowed values: ${ALLOWED_METAOBJECT_COMMANDS.join(", ")}.`,
      );
    }

    const requiresField = command !== "DELETE" && command !== "IGNORE";

    if (requiresField && !field) {
      validationErrors.push(`Row ${csvRowNumber}: Field is required.`);
    }

    if (!handle || !definitionHandle || !ALLOWED_METAOBJECT_COMMANDS.includes(command)) {
      return;
    }

    if (requiresField && !field) {
      return;
    }

    const entryKey = `${definitionHandle}::${handle}`;
    const existing = groupedEntries.get(entryKey);

    if (existing) {
      if (existing.command !== command) {
        validationErrors.push(
          `Row ${csvRowNumber}: Command '${command}' conflicts with previous rows for Handle '${handle}' and Definition: Handle '${definitionHandle}' (currently '${existing.command}').`,
        );
        return;
      }

      if (requiresField) {
        existing.fieldMap.set(field, value);
      }
      return;
    }

    groupedEntries.set(entryKey, {
      handle,
      definitionHandle,
      command,
      fieldMap: requiresField ? new Map([[field, value]]) : new Map(),
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
    command: entry.command,
    fields: Array.from(entry.fieldMap.entries()).map(([key, value]) => ({ key, value })),
  }));

  if (entries.length === 0) {
    return { ok: false, error: "CSV contains no valid rows to import." };
  }

  return { ok: true, entries };
};

