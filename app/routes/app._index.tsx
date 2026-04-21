import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="App Documentation">
      <s-section heading="What this app is for">
        <s-stack gap="base">
          <s-paragraph>
            This app helps migrate media content to Shopify CDN, import and create gift cards, and export/import handle and metaobject data using CSV.
          </s-paragraph>
          <s-paragraph>
            Use the navigation on the sidebar of the app to open each tool page. Each page below includes what it does, why you would use it, and the typical workflow.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Image Migration page">
        <s-stack gap="small">
          <s-text>
            Useful for migrating externally hosted images into Shopify Files and updating content to point at Shopify CDN URLs.
          </s-text>
          <s-text>Core features:</s-text>
          <s-unordered-list>
            <s-list-item>Scan blog articles, pages, and metaobjects for external image URLs.</s-list-item>
            <s-list-item>Import a single image URL and replace only that image in content.</s-list-item>
            <s-list-item>Bulk import all external images for one resource or an entire metaobject group.</s-list-item>
            <s-list-item>Persist the updated HTML/field values back to Shopify after upload.</s-list-item>
          </s-unordered-list>
          <s-text>How to use:</s-text>
          <s-ordered-list>
            <s-list-item>Open Image Migration and choose the content section you want to process.</s-list-item>
            <s-list-item>Review detected external images.</s-list-item>
            <s-list-item>Run single-image import for targeted fixes, or batch import for full migration.</s-list-item>
            <s-list-item>Verify success messages and check that URLs now use Shopify CDN.</s-list-item>
          </s-ordered-list>
        </s-stack>
      </s-section>

      <s-section heading="Gift Card Import page">
        <s-stack gap="small">
          <s-text>
            Useful for managing gift cards quickly: review existing cards, create one manually, or create many from CSV.
          </s-text>
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
        </s-stack>
      </s-section>

      <s-section heading="Import or Export page">
        <s-stack gap="small">
          <s-text>
            Useful for moving catalog and metaobject handle data between systems and running controlled metaobject CSV imports.
          </s-text>
          <s-text>Core features:</s-text>
          <s-unordered-list>
            <s-list-item>Export product, collection, article, and page handles to CSV.</s-list-item>
            <s-list-item>Export metaobjects to CSV with optional field values and import command column.</s-list-item>
            <s-list-item>Import metaobjects via CSV using commands: NEW, MERGE, UPDATE, REPLACE, DELETE, IGNORE.</s-list-item>
            <s-list-item>Get import totals and download error logs for failed rows.</s-list-item>
          </s-unordered-list>
          <s-text>How to use:</s-text>
          <s-ordered-list>
            <s-list-item>Use export first to generate a template and understand expected structure.</s-list-item>
            <s-list-item>Edit CSV with desired command behavior per handle.</s-list-item>
            <s-list-item>Upload CSV in Metaobject Import and run import.</s-list-item>
            <s-list-item>Download error log CSV if any rows fail, then correct and rerun.</s-list-item>
          </s-ordered-list>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Quick start">
        <s-ordered-list>
          <s-list-item>Start with Import or Export to generate reference CSV files.</s-list-item>
          <s-list-item>Use Image Migration to convert external image URLs to Shopify-hosted assets.</s-list-item>
          <s-list-item>Use Gift Card Import when launching or replenishing gift card batches.</s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section slot="aside" heading="Notes">
        <s-unordered-list>
          <s-list-item>Large imports and migrations can take time; wait for completion messages.</s-list-item>
          <s-list-item>Prefer testing CSV changes with small batches before full runs.</s-list-item>
          <s-list-item>Keep a backup export before running REPLACE or DELETE commands.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
