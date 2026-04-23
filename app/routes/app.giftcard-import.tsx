import { useLoaderData, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  loadGiftCardImportData,
  handleGiftCardAction,
  GiftCardsTableSection,
  AddGiftCardSection,
  ImportGiftCardsSection,
} from "app/features/giftcard-import";
import { CollapsibleFeatureInfo } from "app/shared";

/* =========================
   LOADER (READ)
========================= */

export const loader = async ({
  request,
}: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return await loadGiftCardImportData(admin);
};

/* =========================
   ACTION (WRITE)
========================= */

export const action = async ({
  request,
}: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  return await handleGiftCardAction(admin, formData);
};

/* =========================
   MAIN PAGE
========================= */

export default function ImportPage() {
  const { giftCards = [] } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Gift Card Import">
      <CollapsibleFeatureInfo
        slot="aside"
        title="Gift Card Import page"
        summary="Useful for managing gift cards quickly: review existing cards, create one manually, or create many from CSV."
      >
        <s-text>Core features:</s-text>
        <s-unordered-list>
          <s-list-item>View recently fetched gift cards with masked code, amount, and created date.</s-list-item>
          <s-list-item>Create one gift card manually with code, initial value, and note.</s-list-item>
          <s-list-item>Bulk create gift cards from CSV with validation and row-level error feedback.</s-list-item>
        </s-unordered-list>
        <s-text>CSV requirements:</s-text>
        <s-unordered-list>
          <s-list-item>Gift card code</s-list-item>
          <s-list-item>Initial value</s-list-item>
          <s-list-item>Note</s-list-item>
        </s-unordered-list>
        <s-text>How to use:</s-text>
        <s-ordered-list>
          <s-list-item>Prepare CSV with the required headers and valid values.</s-list-item>
          <s-list-item>Upload CSV in the Import Gift Cards section and submit.</s-list-item>
          <s-list-item>Review import summary and row errors, then fix and retry if needed.</s-list-item>
        </s-ordered-list>
      </CollapsibleFeatureInfo>

      <GiftCardsTableSection giftCards={giftCards} />
      <AddGiftCardSection />
      <ImportGiftCardsSection />
    </s-page>
  );
}
