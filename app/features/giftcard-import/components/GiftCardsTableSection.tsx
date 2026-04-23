import React from "react";
import type { GiftCard } from "../types";

interface GiftCardsTableSectionProps {
  giftCards: GiftCard[];
}

export function GiftCardsTableSection({ giftCards }: GiftCardsTableSectionProps) {
  return (
    <s-section heading="Existing Gift Cards">
      {giftCards.length === 0 ? (
        <s-text color="subdued">No gift cards found.</s-text>
      ) : (
        <s-table>
          <s-table-header-row>
            <s-table-header>Code</s-table-header>
            <s-table-header>Amount</s-table-header>
            <s-table-header>Created</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {giftCards.map((giftCard) => (
              <s-table-row key={giftCard.id}>
                <s-table-cell>
                  {`****${giftCard.lastCharacters ?? ""}`}
                </s-table-cell>
                <s-table-cell>
                  {giftCard.balance.amount} {giftCard.balance.currencyCode}
                </s-table-cell>
                <s-table-cell>
                  {new Date(giftCard.createdAt).toLocaleString()}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
    </s-section>
  );
}
