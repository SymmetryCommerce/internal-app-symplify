/**
 * Generic types shared across import/export features
 */

export type ImportErrorLog = {
  id: string;
  message: string;
};

export type ImportSummary = {
  total: number;
  successful: number;
  failed: number;
};

export type ImportActionData = {
  success: boolean;
  error?: string;
  validationErrors?: string[];
  summary?: ImportSummary;
  errorLogs?: ImportErrorLog[];
};
