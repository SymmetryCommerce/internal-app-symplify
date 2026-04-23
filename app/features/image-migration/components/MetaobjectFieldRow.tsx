/* =========================
   METAOBJECT FIELD ROW
========================= */

import { useFetcher } from "react-router";
import { MetaobjectField } from "../types";
import React, { useEffect, useState } from "react";
import { isExternalImageUrl } from "../utils";
import { IMAGE_EXTENSIONS } from "../constants";

export function MetaobjectFieldRow({
  field,
  metaobjectId,
  overrideValue,
  onImported,
}: {
  field: MetaobjectField;
  metaobjectId: string;
  overrideValue?: string | null;
  onImported?: (key: string, newUrl: string) => void;
}) {
  const fetcher = useFetcher();
  const [importError, setImportError] = useState<string | null>(null);
  // Use overrideValue from parent (set by batch import) when available
  const currentValue = overrideValue !== undefined ? overrideValue : field.value;

  const isImporting = fetcher.state !== "idle";

  // When a single-field import finishes, notify parent
  const prevState = React.useRef(fetcher.state);
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = fetcher.state;
    if (prev !== "idle" && fetcher.state === "idle" && fetcher.data) {
      const data = fetcher.data as any;
      if (data.success && data.fieldKey === field.key && data.metaobjectId === metaobjectId) {
        setImportError(null);
        onImported?.(field.key, data.newUrl);
      } else if (data.success === false) {
        setImportError(data.error ?? "Import failed");
      }
    }
  }, [fetcher.state, fetcher.data, field.key, metaobjectId, onImported]);

  const showImportButton = isExternalImageUrl(currentValue);

  function handleImport() {
    setImportError(null);
    fetcher.submit(
      {
        intent: "importMetaobjectImage",
        imgSrc: currentValue!,
        metaobjectId,
        fieldKey: field.key,
      },
      { method: "post" }
    );
  }

  return (
    <s-table-row>
      <s-table-cell>
        <code>{field.key}</code>
      </s-table-cell>
      <s-table-cell>
        <s-badge>{field.type}</s-badge>
      </s-table-cell>
      <s-table-cell>
        {currentValue ? (
          <s-stack gap="small">
            <s-text>{currentValue}</s-text>
            {showImportButton && (
              <s-stack direction="inline" alignItems="center">
                <s-button
                  onClick={handleImport}
                  disabled={isImporting}
                >
                  {isImporting ? "Importing…" : "Import to Shopify CDN"}
                </s-button>
                {importError && (
                  <s-text tone="critical">
                    ⚠ {importError}
                  </s-text>
                )}
              </s-stack>
            )}
            {!showImportButton && currentValue.includes("cdn.shopify.com") && IMAGE_EXTENSIONS.test(currentValue) && (
              <s-text tone="success">
                ✓ Already on Shopify CDN
              </s-text>
            )}
          </s-stack>
        ) : (
          <s-text color="subdued">—</s-text>
        )}
      </s-table-cell>
    </s-table-row>
  );
}