/**
 * GraphQL mutations and related logic for image migration
 */

import { replaceImgSrcByIndex } from "../utils";

type AdminClient = any; // Admin API context from Shopify

/**
 * Uploads an external image to Shopify CDN and returns the CDN URL
 * Handles: staged upload → file registration → polling for CDN availability
 */
export async function uploadExternalImageToShopifyCdn(
  admin: AdminClient,
  imgSrc: string
): Promise<string> {
  const imageRes = await fetch(imgSrc);
  if (!imageRes.ok) {
    throw new Error(`Failed to fetch image: ${imageRes.statusText}`);
  }

  const imageBuffer = await imageRes.arrayBuffer();
  const mimeType =
    imageRes.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const fileSize = imageBuffer.byteLength.toString();
  const filename =
    decodeURIComponent(imgSrc.split("/").pop()?.split("?")[0] ?? "image.jpg") ||
    "image.jpg";

  const stagedRes = await admin.graphql(
    `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
    `,
    {
      variables: {
        input: [
          { filename, mimeType, resource: "FILE", fileSize, httpMethod: "PUT" },
        ],
      },
    }
  );
  const stagedJson = await stagedRes.json();
  const stagedErrors = stagedJson.data.stagedUploadsCreate.userErrors;
  if (stagedErrors?.length) {
    throw new Error(stagedErrors[0].message);
  }
  const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

  const uploadRes = await fetch(target.url, {
    method: "PUT",
    body: imageBuffer,
    headers: { "Content-Type": mimeType, "Content-Length": fileSize },
  });
  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${uploadRes.statusText}`);
  }

  const fileCreateRes = await admin.graphql(
    `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          ... on MediaImage { image { url } }
          ... on GenericFile { url }
        }
        userErrors { field message }
      }
    }
    `,
    {
      variables: {
        files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }],
      },
    }
  );
  const fileJson = await fileCreateRes.json();
  const fileErrors = fileJson.data.fileCreate.userErrors;
  if (fileErrors?.length) {
    throw new Error(fileErrors[0].message);
  }

  const createdFileId: string = fileJson.data.fileCreate.files[0]?.id;
  if (!createdFileId) {
    throw new Error("No file ID returned from fileCreate");
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));

    const pollRes = await admin.graphql(
      `
      query getFile($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            fileStatus
            image { url }
          }
          ... on GenericFile {
            fileStatus
            url
          }
        }
      }
      `,
      { variables: { id: createdFileId } }
    );
    const pollJson = await pollRes.json();
    const node = pollJson.data?.node;
    const status: string = node?.fileStatus ?? "";
    const candidateUrl: string = node?.image?.url ?? node?.url ?? "";

    if (status === "READY" && candidateUrl.startsWith("https://cdn.shopify.com")) {
      return candidateUrl;
    }

    if (status === "FAILED") {
      throw new Error("Shopify file processing failed");
    }
  }

  throw new Error("Timed out waiting for Shopify CDN URL");
}

/**
 * Updates a page's body in Shopify
 */
export async function updatePageBody(
  admin: AdminClient,
  pageId: string,
  body: string
): Promise<void> {
  const updateRes = await admin.graphql(
    `
    mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
      pageUpdate(id: $id, page: $page) {
        page { id body }
        userErrors { field message }
      }
    }
    `,
    { variables: { id: pageId, page: { body } } }
  );
  const updateJson = await updateRes.json();
  const updateErrors = updateJson.data.pageUpdate.userErrors;
  if (updateErrors?.length) {
    throw new Error(updateErrors[0].message);
  }
}

/**
 * Imports a single external image into an article
 */
export async function importArticleImage(
  admin: AdminClient,
  articleId: string,
  imgSrc: string,
  imgIndex: number,
  body: string
): Promise<{ newUrl: string; updatedBody: string }> {
  const newUrl = await uploadExternalImageToShopifyCdn(admin, imgSrc);

  let updatedBody = replaceImgSrcByIndex(body, imgIndex, newUrl);
  if (updatedBody === body) {
    updatedBody = body.split(imgSrc).join(newUrl);
  }

  const updateRes = await admin.graphql(
    `
    mutation articleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id body }
        userErrors { field message }
      }
    }
    `,
    { variables: { id: articleId, article: { body: updatedBody } } }
  );
  const updateJson = await updateRes.json();
  const updateErrors = updateJson.data.articleUpdate.userErrors;
  if (updateErrors?.length) throw new Error(updateErrors[0].message);

  return { newUrl, updatedBody };
}

/**
 * Imports a single external image into a page
 */
export async function importPageImage(
  admin: AdminClient,
  pageId: string,
  imgSrc: string,
  imgIndex: number,
  body: string
): Promise<{ newUrl: string; updatedBody: string }> {
  const newUrl = await uploadExternalImageToShopifyCdn(admin, imgSrc);

  let updatedBody = replaceImgSrcByIndex(body, imgIndex, newUrl);
  if (updatedBody === body) {
    updatedBody = body.split(imgSrc).join(newUrl);
  }

  await updatePageBody(admin, pageId, updatedBody);
  return { newUrl, updatedBody };
}

/**
 * Imports all external images across multiple pages
 */
export async function importAllPageImages(
  admin: AdminClient,
  pages: { pageId: string; body: string; images: { index: number; src: string }[] }[]
): Promise<{
  updatedPages: { pageId: string; updatedBody: string; importedCount: number }[];
  errors: string[];
}> {
  const updatedPages: { pageId: string; updatedBody: string; importedCount: number }[] = [];
  const errors: string[] = [];

  for (const page of pages) {
    let workingBody = page.body;
    let importedCount = 0;

    for (const image of page.images) {
      try {
        const newUrl = await uploadExternalImageToShopifyCdn(admin, image.src);
        const nextBody = replaceImgSrcByIndex(workingBody, image.index, newUrl);
        workingBody = nextBody === workingBody
          ? workingBody.split(image.src).join(newUrl)
          : nextBody;
        importedCount += 1;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push(`${page.pageId}/image-${image.index}: ${message}`);
      }
    }

    if (importedCount > 0) {
      try {
        await updatePageBody(admin, page.pageId, workingBody);
        updatedPages.push({
          pageId: page.pageId,
          updatedBody: workingBody,
          importedCount,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push(`${page.pageId}: ${message}`);
      }
    }
  }

  return { updatedPages, errors };
}

/**
 * Imports a single external image into a metaobject field
 */
export async function importMetaobjectImage(
  admin: AdminClient,
  metaobjectId: string,
  fieldKey: string,
  imgSrc: string
): Promise<{ newUrl: string }> {
  const newUrl = await uploadExternalImageToShopifyCdn(admin, imgSrc);

  const updateRes = await admin.graphql(
    `
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message }
      }
    }
    `,
    {
      variables: {
        id: metaobjectId,
        metaobject: { fields: [{ key: fieldKey, value: newUrl }] },
      },
    }
  );
  const updateJson = await updateRes.json();
  const updateErrors = updateJson.data.metaobjectUpdate.userErrors;
  if (updateErrors?.length) throw new Error(updateErrors[0].message);

  return { newUrl };
}

/**
 * Imports all external image fields for a single metaobject entry
 */
export async function importAllMetaobjectImages(
  admin: AdminClient,
  metaobjectId: string,
  imageFields: { key: string; value: string }[]
): Promise<{
  updatedFields: { key: string; newUrl: string }[];
  errors: string[];
}> {
  const updatedFields: { key: string; newUrl: string }[] = [];
  const errors: string[] = [];

  for (const { key, value: imgSrc } of imageFields) {
    try {
      const newUrl = await uploadExternalImageToShopifyCdn(admin, imgSrc);
      updatedFields.push({ key, newUrl });
    } catch (err: unknown) {
      errors.push(`${key}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (updatedFields.length > 0) {
    const updateRes = await admin.graphql(
      `mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          id: metaobjectId,
          metaobject: { fields: updatedFields.map(({ key, newUrl }) => ({ key, value: newUrl })) },
        },
      }
    );
    const updateJson = await updateRes.json();
    const updateErrors = updateJson.data.metaobjectUpdate.userErrors;
    if (updateErrors?.length) errors.push(updateErrors[0].message);
  }

  return { updatedFields, errors };
}

/**
 * Imports all external images across all entries of a metaobject group
 */
export async function importAllGroupImages(
  admin: AdminClient,
  entries: { metaobjectId: string; fields: { key: string; value: string }[] }[]
): Promise<{
  updatedEntries: { metaobjectId: string; updatedFields: { key: string; newUrl: string }[] }[];
  errors: string[];
}> {
  const updatedEntries: { metaobjectId: string; updatedFields: { key: string; newUrl: string }[] }[] = [];
  const errors: string[] = [];

  for (const { metaobjectId, fields: imageFields } of entries) {
    const updatedFields: { key: string; newUrl: string }[] = [];

    for (const { key, value: imgSrc } of imageFields) {
      try {
        const newUrl = await uploadExternalImageToShopifyCdn(admin, imgSrc);
        updatedFields.push({ key, newUrl });
      } catch (err: unknown) {
        errors.push(`${metaobjectId}/${key}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    if (updatedFields.length > 0) {
      const updateRes = await admin.graphql(
        `mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id: $id, metaobject: $metaobject) {
            metaobject { id handle }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            id: metaobjectId,
            metaobject: { fields: updatedFields.map(({ key, newUrl }) => ({ key, value: newUrl })) },
          },
        }
      );
      const updateJson = await updateRes.json();
      const updateErrors = updateJson.data.metaobjectUpdate.userErrors;
      if (updateErrors?.length) errors.push(updateErrors[0].message);
      updatedEntries.push({ metaobjectId, updatedFields });
    }
  }

  return { updatedEntries, errors };
}

/**
 * Updates an article's body (generic save)
 */
export async function updateArticleBody(
  admin: AdminClient,
  articleId: string,
  body: string
): Promise<any> {
  const response = await admin.graphql(
    `
    mutation articleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id body }
        userErrors { field message }
      }
    }
    `,
    {
      variables: { id: articleId, article: { body } },
    }
  );

  const json = await response.json();
  return json;
}
