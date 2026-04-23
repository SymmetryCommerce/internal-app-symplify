/* =========================
   METAOBJECT ENTRY VIEW
========================= */

import { useState } from "react";
import { MetaobjectEntry } from "../types";
import { MetaobjectFieldRow } from ".";

export function MetaobjectEntryView({
  entry,
  fieldValues,
  onFieldUpdate,
}: {
  entry: MetaobjectEntry;
  fieldValues: Record<string, string | null>;
  onFieldUpdate: (key: string, newUrl: string) => void;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <s-box
      borderWidth="base"
      borderRadius="base"
    >
      <s-clickable
        padding="small"
        borderRadius="base"
        onClick={() => setIsOpen(!isOpen)}
      >
        <s-stack direction="inline" alignItems="center" justifyContent="space-between" inlineSize="100%">
          <code style={{ fontSize: "0.82rem" }}>{entry.handle}</code>
          {isOpen ? <s-icon type="caret-up"/> : <s-icon type="caret-down"/>}
        </s-stack>
      </s-clickable>

      {isOpen && (
        <>
          <s-divider/>
          <s-box>
            <s-table>
              <s-table-header-row>
                <s-table-header>Field</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header>Value</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {entry.fields.map((field) => (
                  <MetaobjectFieldRow
                    key={field.key}
                    field={field}
                    metaobjectId={entry.id}
                    overrideValue={fieldValues[field.key]}
                    onImported={onFieldUpdate}
                  />
                ))}
              </s-table-body>
            </s-table>
          </s-box>
        </>
      )}
    </s-box>
  );
}