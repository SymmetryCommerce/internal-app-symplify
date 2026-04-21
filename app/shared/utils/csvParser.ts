/**
 * Generic CSV utilities used across multiple features
 */

export const parseCsvContent = (csvContent: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows
    .map((currentRow) => currentRow.map((currentCell) => currentCell.trim()))
    .filter((currentRow) => currentRow.some((currentCell) => currentCell.length > 0));
};

export const normalizeHeader = (header: string) => header.trim().toLowerCase();

export const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;

export const parseFilename = (contentDisposition: string | null, defaultName: string = "export.csv"): string => {
  if (!contentDisposition) return defaultName;
  const match = contentDisposition.match(/filename="?([^\"]+)"?/i);
  return match?.[1] ?? defaultName;
};
