import React, { useRef, useEffect, useState } from "react";
import { useFetcher } from "react-router";

export function ImportGiftCardsSection() {
  const importGiftCardsFetcher = useFetcher();
  const dropZoneRef = useRef<any>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const previousImportGiftCardsFetcherState = useRef(importGiftCardsFetcher.state);

  const importGiftCardsData = importGiftCardsFetcher.data as
    | {
        success?: boolean;
        error?: string;
        importedCount?: number;
        validationErrors?: string[];
      }
    | undefined;

  useEffect(() => {
    const dropZone = dropZoneRef.current;
    if (!dropZone) return;

    const handleChange = () => {
      if (dropZone.files && dropZone.files.length > 0) {
        setSelectedFileName(dropZone.files[0].name);
      }
    };

    dropZone.addEventListener("change", handleChange);
    return () => dropZone.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const importFinished =
      previousImportGiftCardsFetcherState.current !== "idle" &&
      importGiftCardsFetcher.state === "idle";

    if (importFinished && dropZoneRef.current) {
      dropZoneRef.current.value = "";
    }

    previousImportGiftCardsFetcherState.current = importGiftCardsFetcher.state;
  }, [importGiftCardsFetcher.state]);

  return (
    <s-section heading="Import Gift Cards (CSV)">
      <s-stack gap="small">
        <s-text color="subdued">
          Required headers: Gift card code, Initial value, Note
        </s-text>

        <importGiftCardsFetcher.Form method="post" encType="multipart/form-data">
          <s-stack gap="small">
            <input type="hidden" name="intent" value="importGiftCardsCsv" />
            <s-drop-zone
              ref={dropZoneRef}
              name="csvFile"
              label={selectedFileName ? `✓ ${selectedFileName}` : "Drag CSV file here or click to upload"}
              accept=".csv,text/csv"
              required
              disabled={importGiftCardsFetcher.state !== "idle"}
            />
            <s-button type="submit" disabled={importGiftCardsFetcher.state !== "idle"}>
              {importGiftCardsFetcher.state !== "idle" ? "Importing..." : "Import gift cards"}
            </s-button>
          </s-stack>
        </importGiftCardsFetcher.Form>

        {importGiftCardsData?.error && (
          <s-text tone="critical">{importGiftCardsData.error}</s-text>
        )}

        {importGiftCardsData?.validationErrors && importGiftCardsData.validationErrors.length > 0 && (
          <s-stack gap="none">
            {importGiftCardsData.validationErrors.map((errorMessage) => (
              <s-text key={errorMessage} tone="critical">
                {errorMessage}
              </s-text>
            ))}
          </s-stack>
        )}

        {importGiftCardsData?.success && !importGiftCardsData.error && (
          <s-text tone="success">
            Successfully imported {importGiftCardsData.importedCount ?? 0} gift card(s).
          </s-text>
        )}
      </s-stack>
    </s-section>
  );
}
