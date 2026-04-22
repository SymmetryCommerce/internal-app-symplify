import React from "react";
import { useFetcher } from "react-router";

export function AddGiftCardSection() {
  const addGiftCardFetcher = useFetcher();

  const addGiftCardData = addGiftCardFetcher.data as
    | { success?: boolean; error?: string; giftCardCode?: string }
    | undefined;

  return (
    <s-section heading="Add a Gift Card">
      <addGiftCardFetcher.Form method="post">
        <s-stack gap="base">
          <input type="hidden" name="intent" value="addGiftCard" />
          <s-text-field
            label="Gift card code"
            name="giftCardCode"
            required
          />
          <s-number-field
            label="Initial value"
            name="initialValue"
            inputMode="decimal"
            prefix="$"
            suffix="USD"
            min={0.01}
            step={0.01}
            required
          />
          <s-text-field
            label="Note"
            name="note"
          />
          <s-button type="submit" disabled={addGiftCardFetcher.state !== "idle"}>
            {addGiftCardFetcher.state !== "idle" ? "Adding..." : "Add gift card"}
          </s-button>
        </s-stack>
      </addGiftCardFetcher.Form>

      {addGiftCardData?.error && (
        <s-text tone="critical">{addGiftCardData.error}</s-text>
      )}
      {addGiftCardData?.success && !addGiftCardData.error && (
        <s-text tone="success">
          Gift card created successfully ({addGiftCardData.giftCardCode ?? "code hidden"}). Refresh to see it in the list.
        </s-text>
      )}
    </s-section>
  );
}
