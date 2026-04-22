/* =========================
   METAOBJECT GROUP VIEW
========================= */

import React, { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { MetaobjectEntryView } from ".";
import { MetaobjectEntry, MetaobjectGroup } from "../types";
import { isExternalImageUrl } from "../utils";

export function MetaobjectGroupView({ group, isOpen, onToggle }: { group: MetaobjectGroup; isOpen: boolean; onToggle: () => void }) {
  // fieldValues[entryId][fieldKey] = current value
  const [fieldValues, setFieldValues] = useState<Record<string, Record<string, string | null>>>(
    () => Object.fromEntries(
      group.entries.map((e) => [
        e.id,
        Object.fromEntries(e.fields.map((f) => [f.key, f.value])),
      ])
    )
  );

  const batchFetcher = useFetcher();
  const isBatchImporting = batchFetcher.state !== "idle";

  // Collect all external image fields across all entries
  const allImportable = group.entries.flatMap((entry) =>
    entry.fields
      .filter((f) => isExternalImageUrl(fieldValues[entry.id]?.[f.key]))
      .map((f) => ({ metaobjectId: entry.id, key: f.key, value: fieldValues[entry.id][f.key]! }))
  );

  // When group batch import finishes, apply all updated URLs
  const prevState = React.useRef(batchFetcher.state);
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = batchFetcher.state;
    if (prev !== "idle" && batchFetcher.state === "idle" && batchFetcher.data) {
      const data = batchFetcher.data as any;
      if (data.updatedEntries?.length) {
        setFieldValues((cur) => {
          const next = { ...cur };
          for (const { metaobjectId, updatedFields } of data.updatedEntries) {
            next[metaobjectId] = { ...next[metaobjectId] };
            for (const { key, newUrl } of updatedFields) next[metaobjectId][key] = newUrl;
          }
          return next;
        });
      }
    }
  }, [batchFetcher.state, batchFetcher.data]);

  function handleImportAll() {
    // Group by entry
    const byEntry: Record<string, { key: string; value: string }[]> = {};
    for (const { metaobjectId, key, value } of allImportable) {
      if (!byEntry[metaobjectId]) byEntry[metaobjectId] = [];
      byEntry[metaobjectId].push({ key, value });
    }
    batchFetcher.submit(
      {
        intent: "importAllGroupImages",
        entries: JSON.stringify(
          Object.entries(byEntry).map(([metaobjectId, fields]) => ({ metaobjectId, fields }))
        ),
      },
      { method: "post" }
    );
  }

  function handleFieldUpdate(entryId: string, key: string, newUrl: string) {
    setFieldValues((cur) => ({
      ...cur,
      [entryId]: { ...cur[entryId], [key]: newUrl },
    }));
  }

  const batchData = batchFetcher.data as any;

  return (
    <s-stack
      background="subdued"
      borderWidth="base"
      borderRadius="base"
    >
      <s-clickable 
        borderRadius="base"
        padding="small"
        onClick={onToggle}
      >
        <s-stack
          direction="inline"
          alignItems="center"
          justifyContent="space-between"
          inlineSize="100%"
        >
          <s-stack direction="inline" alignItems="center" gap="base">
            {group.name}{" "}
            <s-badge><code>{group.type}</code></s-badge>
            {" "}
            <s-badge>{group.entries.length} entries</s-badge>
          </s-stack>
          <s-stack direction="inline" alignItems="center" gap="base">
            {allImportable.length > 0 && (
              <s-button
                onClick={(e) => { e.preventDefault(); handleImportAll(); }}
                disabled={isBatchImporting}
              >
                {isBatchImporting
                  ? "Importing…"
                  : `Import All Images (${allImportable.length})`}
              </s-button>
            )}
            {isOpen ? <s-icon type="caret-up"/> : <s-icon type="caret-down"/>}
          </s-stack>
        </s-stack>
      </s-clickable>

      <s-box padding="none small none small">
        {batchData?.errors?.length > 0 && (
          <s-banner heading="Error" tone="critical">
            {batchData.errors.map((e: string, i: number) => 
              <s-text key={i}>{e}</s-text>
            )}
          </s-banner>
        )}
      </s-box>

      {isOpen && (
        <s-stack
          padding="small"
          background="base"
          borderRadius="none none base base"
          gap="small"
        >
          {group.entries.length === 0 ? (
            <s-text color="subdued"><em>No entries</em></s-text>
          ) : (
            group.entries.map((entry: MetaobjectEntry) => (
              <MetaobjectEntryView
                key={entry.id}
                entry={entry}
                fieldValues={fieldValues[entry.id] ?? {}}
                onFieldUpdate={(key, newUrl) => handleFieldUpdate(entry.id, key, newUrl)}
              />
            ))
          )}
        </s-stack>
      )}
    </s-stack>
  );
}