import { useLoaderData, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  loadGiftCardImportData,
  handleGiftCardAction,
  GiftCardsTableSection,
  AddGiftCardSection,
  ImportGiftCardsSection,
} from "app/features/giftcard-import";

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
      <GiftCardsTableSection giftCards={giftCards} />
      <AddGiftCardSection />
      <ImportGiftCardsSection />
    </s-page>
  );
}
