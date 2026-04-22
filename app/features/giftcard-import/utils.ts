import { REQUIRED_GIFT_CARD_CSV_HEADERS } from "./constants";
import type { CsvGiftCardRow } from "./types";

/**
 * Validates gift card CSV rows against required headers and business rules.
 * Feature-specific validation for giftcard-import feature.
 */
export function validateGiftCardCsvRows(
  csvRows: string[][]
):
  | { ok: true; rows: CsvGiftCardRow[] }
  | { ok: false; error: string; validationErrors?: string[] } {
  if (csvRows.length === 0) {
    return { ok: false, error: "CSV file is empty." };
  }

  const [headerRow, ...dataRows] = csvRows;
  const headerMap = new Map<string, number>();

  headerRow.forEach((header, index) => {
    headerMap.set(header.trim(), index);
  });

  const missingHeaders = REQUIRED_GIFT_CARD_CSV_HEADERS.filter(
    (header) => !headerMap.has(header)
  );

  if (missingHeaders.length > 0) {
    return {
      ok: false,
      error: `CSV is missing required header(s): ${missingHeaders.join(", ")}. Expected headers: ${REQUIRED_GIFT_CARD_CSV_HEADERS.join(", ")}.`,
    };
  }

  if (dataRows.length === 0) {
    return { ok: false, error: "CSV has headers but no gift card rows." };
  }

  const codeIndex = headerMap.get("Gift card code")!;
  const valueIndex = headerMap.get("Initial value")!;
  const noteIndex = headerMap.get("Note")!;

  const rows: CsvGiftCardRow[] = [];
  const validationErrors: string[] = [];

  dataRows.forEach((row, rowIndex) => {
    const sheetRowNumber = rowIndex + 2;
    const giftCardCode = (row[codeIndex] ?? "").trim();
    const initialValue = (row[valueIndex] ?? "").trim();
    const note = (row[noteIndex] ?? "").trim();

    if (!giftCardCode) {
      validationErrors.push(`Row ${sheetRowNumber}: Gift card code is required.`);
    } else if (giftCardCode.length < 8) {
      validationErrors.push(
        `Row ${sheetRowNumber}: Gift card code must be at least 8 characters long.`
      );
    }

    const parsedValue = Number(initialValue);
    if (!initialValue) {
      validationErrors.push(`Row ${sheetRowNumber}: Initial value is required.`);
    } else if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      validationErrors.push(
        `Row ${sheetRowNumber}: Initial value must be a number greater than 0.`
      );
    }

    rows.push({ giftCardCode, initialValue, note });
  });

  if (validationErrors.length > 0) {
    return {
      ok: false,
      error: "CSV validation failed. Fix the issues listed below and try again.",
      validationErrors,
    };
  }

  return { ok: true, rows };
}
