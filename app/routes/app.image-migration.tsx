import React from "react";
import {
  useLoaderData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";

import { authenticate } from "../shopify.server";
import { 
  loadImageMigrationData,
  importArticleImage,
  importAllPageImages,
  importPageImage,
  importMetaobjectImage,
  importAllMetaobjectImages,
  importAllGroupImages,
  updateArticleBody,
  BlogsSection,
  MetaobjectsSection,
  PagesSection,
  useImageMigrationUI,
  usePageBatchImport,
} from "app/features/image-migration";
import { CollapsibleFeatureInfo } from "app/shared";



/* =========================
   LOADER (READ)
========================= */

export const loader = async ({
  request,
}: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return await loadImageMigrationData(admin);
};

/* =========================
   ACTION (WRITE)
========================= */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    /* ------ Import an external image to Shopify CDN ------ */
    if (intent === "importImage") {
      const imgSrc = formData.get("imgSrc") as string;
      const articleId = formData.get("articleId") as string;
      const imgIndex = parseInt(formData.get("imgIndex") as string, 10);
      const body = formData.get("body") as string;

      const { newUrl, updatedBody } = await importArticleImage(admin, articleId, imgSrc, imgIndex, body);
      return { success: true, newUrl, imgIndex, updatedBody };
    }

    /* ------ Import an external image to Shopify CDN for a page ------ */
    if (intent === "importPageImage") {
      const imgSrc = formData.get("imgSrc") as string;
      const pageId = formData.get("pageId") as string;
      const imgIndex = parseInt(formData.get("imgIndex") as string, 10);
      const body = formData.get("body") as string;

      const { newUrl, updatedBody } = await importPageImage(admin, pageId, imgSrc, imgIndex, body);
      return { success: true, pageId, newUrl, imgIndex, updatedBody };
    }

    /* ------ Import ALL external images across all selected pages ------ */
    if (intent === "importAllPageImages") {
      const pagesJson = formData.get("pages") as string;
      const pages: { pageId: string; body: string; images: { index: number; src: string }[] }[] =
        JSON.parse(pagesJson);

      const { updatedPages, errors } = await importAllPageImages(admin, pages);
      return {
        success: errors.length === 0,
        updatedPages,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    /* ------ Import an external image for a metaobject field ------ */
    if (intent === "importMetaobjectImage") {
      const imgSrc = formData.get("imgSrc") as string;
      const metaobjectId = formData.get("metaobjectId") as string;
      const fieldKey = formData.get("fieldKey") as string;

      const { newUrl } = await importMetaobjectImage(admin, metaobjectId, fieldKey, imgSrc);
      return { success: true, newUrl, fieldKey, metaobjectId };
    }

    /* ------ Import ALL external image fields for a metaobject entry ------ */
    if (intent === "importAllMetaobjectImages") {
      const metaobjectId = formData.get("metaobjectId") as string;
      const fieldsJson = formData.get("fields") as string;
      const imageFields: { key: string; value: string }[] = JSON.parse(fieldsJson);

      const { updatedFields, errors } = await importAllMetaobjectImages(admin, metaobjectId, imageFields);
      return {
        success: errors.length === 0,
        updatedFields,
        metaobjectId,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    /* ------ Import ALL external images across every entry of a group ------ */
    if (intent === "importAllGroupImages") {
      const entriesJson = formData.get("entries") as string;
      const entries: { metaobjectId: string; fields: { key: string; value: string }[] }[] =
        JSON.parse(entriesJson);

      const { updatedEntries, errors } = await importAllGroupImages(admin, entries);
      return {
        success: errors.length === 0,
        updatedEntries,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    /* ------ Default: save article body ------ */
    const articleId = formData.get("articleId") as string;
    const body = formData.get("body") as string;
    return await updateArticleBody(admin, articleId, body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
};

/* =========================
   MAIN PAGE
========================= */

export default function ImageMigration() {
  const { blogs = [], pages = [], metaobjectGroups = [] } =
    useLoaderData<typeof loader>();

  // UI state management
  const {
    openBlogIds,
    toggleBlog,
    openArticleIds,
    toggleArticle,
    openMetaobjectIds,
    toggleMetaobjectGroup,
  } = useImageMigrationUI();

  // Page batch import state management
  const {
    pageBatchFetcher,
    pageBodies,
    isImportingAllPages,
    allImportablePages,
    handleImportAllPageImages,
    handlePageBodyUpdated,
  } = usePageBatchImport(pages);

  return (
    <s-page heading="Image Migration">
      <CollapsibleFeatureInfo
        slot="aside"
        title="Image Migration page"
        summary="Useful for migrating externally hosted images into Shopify Files and updating content to point at Shopify CDN URLs."
      >
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
      </CollapsibleFeatureInfo>

      <BlogsSection
        blogs={blogs}
        openBlogIds={openBlogIds}
        openArticleIds={openArticleIds}
        onToggleBlog={toggleBlog}
        onToggleArticle={toggleArticle}
      />

      <MetaobjectsSection
        metaobjectGroups={metaobjectGroups}
        openMetaobjectIds={openMetaobjectIds}
        onToggleMetaobjectGroup={toggleMetaobjectGroup}
      />

      <PagesSection
        pages={pages}
        pageBodies={pageBodies}
        onBodyUpdated={handlePageBodyUpdated}
        isImportingAllPages={isImportingAllPages}
        allImportablePages={allImportablePages}
        onImportAllPageImages={handleImportAllPageImages}
        fetcher={pageBatchFetcher}
      />
    </s-page>
  );
}