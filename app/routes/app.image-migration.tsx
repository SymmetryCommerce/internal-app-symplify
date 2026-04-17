import React, { useEffect, useState } from "react";
import {
  useLoaderData,
  useFetcher,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";

import { authenticate } from "../shopify.server";

/* =========================
   TYPES
========================= */

type ArticleNode = {
  id: string;
  title: string;
  handle?: string;
  body?: string;
  summary?: string;
};

type ArticleEdge = {
  node: ArticleNode;
};

type ArticlesConnection = {
  edges: ArticleEdge[];
};

type BlogNode = {
  id: string;
  title: string;
  handle: string;
  articles?: ArticlesConnection;
};

type BlogEdge = {
  node: BlogNode;
};

type PageNode = {
  id: string;
  title: string;
  handle: string;
  body?: string;
};

type PageEdge = {
  node: PageNode;
};

type ImgInfo = {
  src: string;
  alt: string;
  index: number;
};

type MetaobjectField = {
  key: string;
  value: string | null;
  type: string;
};

type MetaobjectEntry = {
  id: string;
  handle: string;
  fields: MetaobjectField[];
};

type MetaobjectGroup = {
  type: string;
  name: string;
  entries: MetaobjectEntry[];
};

const IMG_TAG_REGEX = /<img\b[^>]*>/gi;

function replaceImgSrcByIndex(html: string, targetIndex: number, newSrc: string): string {
  let currentIndex = -1;
  let replaced = false;

  const updated = html.replace(IMG_TAG_REGEX, (tag) => {
    currentIndex += 1;
    if (currentIndex !== targetIndex) return tag;

    replaced = true;
    const quotedSrcRegex = /\bsrc\s*=\s*(['"])(.*?)\1/i;
    if (quotedSrcRegex.test(tag)) {
      return tag.replace(quotedSrcRegex, (_m, quote: string) => `src=${quote}${newSrc}${quote}`);
    }

    const unquotedSrcRegex = /\bsrc\s*=\s*([^\s"'=<>`]+)/i;
    if (unquotedSrcRegex.test(tag)) {
      return tag.replace(unquotedSrcRegex, `src="${newSrc}"`);
    }

    if (tag.endsWith("/>")) return `${tag.slice(0, -2)} src="${newSrc}" />`;
    if (tag.endsWith(">")) return `${tag.slice(0, -1)} src="${newSrc}">`;
    return tag;
  });

  return replaced ? updated : html;
}

/* =========================
   LOADER (READ)
========================= */

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<{
  blogs: BlogEdge[];
  pages: PageEdge[];
  metaobjectGroups: MetaobjectGroup[];
}> => {
  const { admin } = await authenticate.admin(request);

  // Step 1: fetch blogs + definition types in one query
  const firstRes = await admin.graphql(`
    query GetBlogsAndDefinitions {
      blogs(first: 5) {
        edges {
          node {
            id
            title
            handle
            articles(first: 5) {
              edges {
                node {
                  id
                  title
                  handle
                  body
                  summary
                }
              }
            }
          }
        }
      }
      pages(first: 100) {
        edges {
          node {
            id
            title
            handle
            body
          }
        }
      }
      metaobjectDefinitions(first: 100) {
        edges {
          node {
            type
            name
          }
        }
      }
    }
  `);

  const firstJson = await firstRes.json();
  const blogs: BlogEdge[] = firstJson.data.blogs.edges;
  const pages: PageEdge[] = firstJson.data.pages.edges;
  const definitionEdges: { node: { type: string; name: string } }[] =
    firstJson.data.metaobjectDefinitions.edges;

  // Step 2: fetch actual metaobject entries for each type
  const metaobjectGroups: MetaobjectGroup[] = await Promise.all(
    definitionEdges.map(async ({ node: def }) => {
      const res = await admin.graphql(
        `
        query GetMetaobjects($type: String!) {
          metaobjects(type: $type, first: 100) {
            edges {
              node {
                id
                handle
                fields {
                  key
                  value
                  type
                }
              }
            }
          }
        }
        `,
        { variables: { type: def.type } }
      );
      const json = await res.json();
      const entries: MetaobjectEntry[] = json.data.metaobjects.edges.map(
        (e: { node: MetaobjectEntry }) => e.node
      );
      return { type: def.type, name: def.name, entries };
    })
  );

  return { blogs, pages, metaobjectGroups };
};

/* =========================
   ACTION (WRITE)
========================= */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  async function uploadExternalImageToShopifyCdn(imgSrc: string): Promise<string> {
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

  async function updatePageBody(pageId: string, body: string) {
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

  /* ------ Import an external image to Shopify CDN ------ */
  if (intent === "importImage") {
    const imgSrc = formData.get("imgSrc") as string;
    const articleId = formData.get("articleId") as string;
    const imgIndex = parseInt(formData.get("imgIndex") as string, 10);
    const body = formData.get("body") as string;

    try {
      // 1. Fetch the external image
      const imageRes = await fetch(imgSrc);
      if (!imageRes.ok)
        throw new Error(`Failed to fetch image: ${imageRes.statusText}`);
      const imageBuffer = await imageRes.arrayBuffer();
      const mimeType =
        imageRes.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      const fileSize = imageBuffer.byteLength.toString();
      const filename =
        decodeURIComponent(
          imgSrc.split("/").pop()?.split("?")[0] ?? "image.jpg"
        ) || "image.jpg";

      // 2. Create a staged upload target
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
      const stagedErrors =
        stagedJson.data.stagedUploadsCreate.userErrors;
      if (stagedErrors?.length) throw new Error(stagedErrors[0].message);
      const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

      // 3. PUT the image bytes to the staged URL
      const uploadRes = await fetch(target.url, {
        method: "PUT",
        body: imageBuffer,
        headers: { "Content-Type": mimeType, "Content-Length": fileSize },
      });
      if (!uploadRes.ok)
        throw new Error(`Upload failed: ${uploadRes.statusText}`);

      // 4. Register the file in Shopify Files
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
      if (fileErrors?.length) throw new Error(fileErrors[0].message);

      const createdFileId: string = fileJson.data.fileCreate.files[0]?.id;
      if (!createdFileId) throw new Error("No file ID returned from fileCreate");

      // 5. Poll until Shopify finishes processing and exposes the real CDN URL
      let newUrl: string | null = null;
      const maxAttempts = 15;
      const delayMs = 1500;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, delayMs));

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

        if (
          status === "READY" &&
          candidateUrl.startsWith("https://cdn.shopify.com")
        ) {
          newUrl = candidateUrl;
          break;
        }

        if (status === "FAILED") throw new Error("Shopify file processing failed");
      }

      if (!newUrl) throw new Error("Timed out waiting for Shopify CDN URL");

      // 6. Replace the exact image's src by index (more reliable than raw string replacement)
      let updatedBody = replaceImgSrcByIndex(body, imgIndex, newUrl);
      if (updatedBody === body) {
        updatedBody = body.split(imgSrc).join(newUrl);
      }

      // 7. Persist the updated HTML back to the article
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

      return { success: true, newUrl, imgIndex, updatedBody };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /* ------ Import an external image to Shopify CDN for a page ------ */
  if (intent === "importPageImage") {
    const imgSrc = formData.get("imgSrc") as string;
    const pageId = formData.get("pageId") as string;
    const imgIndex = parseInt(formData.get("imgIndex") as string, 10);
    const body = formData.get("body") as string;

    try {
      const newUrl = await uploadExternalImageToShopifyCdn(imgSrc);

      let updatedBody = replaceImgSrcByIndex(body, imgIndex, newUrl);
      if (updatedBody === body) {
        updatedBody = body.split(imgSrc).join(newUrl);
      }

      await updatePageBody(pageId, updatedBody);
      return { success: true, pageId, newUrl, imgIndex, updatedBody };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /* ------ Import ALL external images across all selected pages ------ */
  if (intent === "importAllPageImages") {
    const pagesJson = formData.get("pages") as string;
    const pages: { pageId: string; body: string; images: { index: number; src: string }[] }[] =
      JSON.parse(pagesJson);

    const updatedPages: { pageId: string; updatedBody: string; importedCount: number }[] = [];
    const errors: string[] = [];

    for (const page of pages) {
      let workingBody = page.body;
      let importedCount = 0;

      for (const image of page.images) {
        try {
          const newUrl = await uploadExternalImageToShopifyCdn(image.src);

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
          await updatePageBody(page.pageId, workingBody);
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

    try {
      const imageRes = await fetch(imgSrc);
      if (!imageRes.ok)
        throw new Error(`Failed to fetch image: ${imageRes.statusText}`);
      const imageBuffer = await imageRes.arrayBuffer();
      const mimeType =
        imageRes.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      const fileSize = imageBuffer.byteLength.toString();
      const filename =
        decodeURIComponent(
          imgSrc.split("/").pop()?.split("?")[0] ?? "image.jpg"
        ) || "image.jpg";

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
      if (stagedErrors?.length) throw new Error(stagedErrors[0].message);
      const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

      const uploadRes = await fetch(target.url, {
        method: "PUT",
        body: imageBuffer,
        headers: { "Content-Type": mimeType, "Content-Length": fileSize },
      });
      if (!uploadRes.ok)
        throw new Error(`Upload failed: ${uploadRes.statusText}`);

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
      if (fileErrors?.length) throw new Error(fileErrors[0].message);

      const createdFileId: string = fileJson.data.fileCreate.files[0]?.id;
      if (!createdFileId) throw new Error("No file ID returned from fileCreate");

      let newUrl: string | null = null;
      const maxAttempts = 15;
      const delayMs = 1500;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, delayMs));
        const pollRes = await admin.graphql(
          `
          query getFile($id: ID!) {
            node(id: $id) {
              ... on MediaImage { fileStatus image { url } }
              ... on GenericFile { fileStatus url }
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
          newUrl = candidateUrl;
          break;
        }
        if (status === "FAILED") throw new Error("Shopify file processing failed");
      }

      if (!newUrl) throw new Error("Timed out waiting for Shopify CDN URL");

      // Update the metaobject field to the new CDN URL
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

      return { success: true, newUrl, fieldKey, metaobjectId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /* ------ Import ALL external image fields for a metaobject entry ------ */
  if (intent === "importAllMetaobjectImages") {
    const metaobjectId = formData.get("metaobjectId") as string;
    const fieldsJson = formData.get("fields") as string;
    const imageFields: { key: string; value: string }[] = JSON.parse(fieldsJson);

    const updatedFields: { key: string; newUrl: string }[] = [];
    const errors: string[] = [];

    for (const { key, value: imgSrc } of imageFields) {
      try {
        const imageRes = await fetch(imgSrc);
        if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageRes.statusText}`);
        const imageBuffer = await imageRes.arrayBuffer();
        const mimeType = imageRes.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
        const fileSize = imageBuffer.byteLength.toString();
        const filename =
          decodeURIComponent(imgSrc.split("/").pop()?.split("?")[0] ?? "image.jpg") || "image.jpg";

        const stagedRes = await admin.graphql(
          `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets { url resourceUrl parameters { name value } }
              userErrors { field message }
            }
          }`,
          { variables: { input: [{ filename, mimeType, resource: "FILE", fileSize, httpMethod: "PUT" }] } }
        );
        const stagedJson = await stagedRes.json();
        const stagedErrors = stagedJson.data.stagedUploadsCreate.userErrors;
        if (stagedErrors?.length) throw new Error(stagedErrors[0].message);
        const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

        const uploadRes = await fetch(target.url, {
          method: "PUT",
          body: imageBuffer,
          headers: { "Content-Type": mimeType, "Content-Length": fileSize },
        });
        if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.statusText}`);

        const fileCreateRes = await admin.graphql(
          `mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files { id fileStatus ... on MediaImage { image { url } } ... on GenericFile { url } }
              userErrors { field message }
            }
          }`,
          { variables: { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }] } }
        );
        const fileJson = await fileCreateRes.json();
        const fileErrors = fileJson.data.fileCreate.userErrors;
        if (fileErrors?.length) throw new Error(fileErrors[0].message);

        const createdFileId: string = fileJson.data.fileCreate.files[0]?.id;
        if (!createdFileId) throw new Error("No file ID returned from fileCreate");

        let newUrl: string | null = null;
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise((r) => setTimeout(r, 1500));
          const pollRes = await admin.graphql(
            `query getFile($id: ID!) { node(id: $id) {
              ... on MediaImage { fileStatus image { url } }
              ... on GenericFile { fileStatus url }
            }}`,
            { variables: { id: createdFileId } }
          );
          const pollJson = await pollRes.json();
          const node = pollJson.data?.node;
          const status: string = node?.fileStatus ?? "";
          const candidateUrl: string = node?.image?.url ?? node?.url ?? "";
          if (status === "READY" && candidateUrl.startsWith("https://cdn.shopify.com")) {
            newUrl = candidateUrl;
            break;
          }
          if (status === "FAILED") throw new Error("Shopify file processing failed");
        }
        if (!newUrl) throw new Error("Timed out waiting for Shopify CDN URL");

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

    const updatedEntries: { metaobjectId: string; updatedFields: { key: string; newUrl: string }[] }[] = [];
    const errors: string[] = [];

    for (const { metaobjectId, fields: imageFields } of entries) {
      const updatedFields: { key: string; newUrl: string }[] = [];

      for (const { key, value: imgSrc } of imageFields) {
        try {
          const imageRes = await fetch(imgSrc);
          if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageRes.statusText}`);
          const imageBuffer = await imageRes.arrayBuffer();
          const mimeType = imageRes.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
          const fileSize = imageBuffer.byteLength.toString();
          const filename =
            decodeURIComponent(imgSrc.split("/").pop()?.split("?")[0] ?? "image.jpg") || "image.jpg";

          const stagedRes = await admin.graphql(
            `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
              stagedUploadsCreate(input: $input) {
                stagedTargets { url resourceUrl parameters { name value } }
                userErrors { field message }
              }
            }`,
            { variables: { input: [{ filename, mimeType, resource: "FILE", fileSize, httpMethod: "PUT" }] } }
          );
          const stagedJson = await stagedRes.json();
          const stagedErrors = stagedJson.data.stagedUploadsCreate.userErrors;
          if (stagedErrors?.length) throw new Error(stagedErrors[0].message);
          const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

          const uploadRes = await fetch(target.url, {
            method: "PUT",
            body: imageBuffer,
            headers: { "Content-Type": mimeType, "Content-Length": fileSize },
          });
          if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.statusText}`);

          const fileCreateRes = await admin.graphql(
            `mutation fileCreate($files: [FileCreateInput!]!) {
              fileCreate(files: $files) {
                files { id fileStatus ... on MediaImage { image { url } } ... on GenericFile { url } }
                userErrors { field message }
              }
            }`,
            { variables: { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }] } }
          );
          const fileJson = await fileCreateRes.json();
          const fileErrors = fileJson.data.fileCreate.userErrors;
          if (fileErrors?.length) throw new Error(fileErrors[0].message);

          const createdFileId: string = fileJson.data.fileCreate.files[0]?.id;
          if (!createdFileId) throw new Error("No file ID returned from fileCreate");

          let newUrl: string | null = null;
          for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise((r) => setTimeout(r, 1500));
            const pollRes = await admin.graphql(
              `query getFile($id: ID!) { node(id: $id) {
                ... on MediaImage { fileStatus image { url } }
                ... on GenericFile { fileStatus url }
              }}`,
              { variables: { id: createdFileId } }
            );
            const pollJson = await pollRes.json();
            const node = pollJson.data?.node;
            const status: string = node?.fileStatus ?? "";
            const candidateUrl: string = node?.image?.url ?? node?.url ?? "";
            if (status === "READY" && candidateUrl.startsWith("https://cdn.shopify.com")) {
              newUrl = candidateUrl;
              break;
            }
            if (status === "FAILED") throw new Error("Shopify file processing failed");
          }
          if (!newUrl) throw new Error("Timed out waiting for Shopify CDN URL");

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

    return {
      success: errors.length === 0,
      updatedEntries,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /* ------ Default: save article body ------ */
  const articleId = formData.get("articleId") as string;
  const body = formData.get("body") as string;

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
  console.log("Mutation response:", json);
  return json;
};

/* =========================
   MAIN PAGE
========================= */

export default function TestingPageSean() {
  const { blogs = [], pages = [], metaobjectGroups = [] } =
    useLoaderData<typeof loader>();

  const pageBatchFetcher = useFetcher();
  const [openBlogIds, setOpenBlogIds] = useState<Record<string, boolean>>({});
  const [openArticleIds, setOpenArticleIds] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [openMetaobjectIds, setOpenMetaobjectIds] = useState<Record<string, boolean>>({});
  const [pageBodies, setPageBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(pages.map((edge) => [edge.node.id, edge.node.body ?? ""]))
  );

  const isImportingAllPages = pageBatchFetcher.state !== "idle";

  const prevPageBatchState = React.useRef(pageBatchFetcher.state);
  useEffect(() => {
    const prev = prevPageBatchState.current;
    prevPageBatchState.current = pageBatchFetcher.state;

    if (prev !== "idle" && pageBatchFetcher.state === "idle" && pageBatchFetcher.data) {
      const data = pageBatchFetcher.data as any;
      if (data.updatedPages?.length) {
        setPageBodies((cur) => {
          const next = { ...cur };
          for (const page of data.updatedPages) {
            next[page.pageId] = page.updatedBody;
          }
          return next;
        });
      }
    }
  }, [pageBatchFetcher.state, pageBatchFetcher.data]);

  const allImportablePages = pages
    .map((edge) => {
      const page = edge.node;
      const body = pageBodies[page.id] ?? page.body ?? "";
      const images = extractImagesFromHtml(body)
        .filter((img) => isExternalImageUrl(img.src))
        .map((img) => ({ index: img.index, src: img.src }));

      return { pageId: page.id, body, images };
    })
    .filter((p) => p.images.length > 0);

  function handleImportAllPageImages() {
    if (allImportablePages.length === 0) return;
    pageBatchFetcher.submit(
      {
        intent: "importAllPageImages",
        pages: JSON.stringify(allImportablePages),
      },
      { method: "post" }
    );
  }

  function handlePageBodyUpdated(pageId: string, updatedBody: string) {
    setPageBodies((cur) => ({
      ...cur,
      [pageId]: updatedBody,
    }));
  }

  function toggleBlog(blogId: string) {
    setOpenBlogIds((cur) => ({
      ...cur,
      [blogId]: !cur[blogId],
    }));
  }

  function toggleArticle(blogId: string, articleId: string) {
    setOpenArticleIds((cur) => ({
      ...cur,
      [blogId]: {
        ...(cur[blogId] ?? {}),
        [articleId]: !(cur[blogId]?.[articleId]),
      },
    }));
  }

  function toggleMetaobjectGroup(groupType: string) {
    setOpenMetaobjectIds((cur) => ({
      ...cur,
      [groupType]: !cur[groupType],
    }));
  }

  return (
    <s-page heading="Image Migration">
      {/* ── Blogs ── */}
      <s-section>
        <s-heading>
          Blogs ({blogs.length})
        </s-heading>

        <s-stack direction="block" gap="base">
          {blogs.map((blogEdge) => {
            const blog = blogEdge.node;
            const articles = blog.articles?.edges ?? [];
            const isBlogOpen = openBlogIds[blog.id] ?? false;
            const openArticles = openArticleIds[blog.id] ?? {};

            return (              
              <s-stack
                key={blog.id} 
                id={`blog-toggle-${blog.id}`}
                background="subdued"
                borderWidth="base"
                borderRadius="base"
              >
                <s-clickable 
                  borderRadius="base"
                  padding="small"
                  onClick={() => toggleBlog(blog.id)}
                >
                  <s-stack
                    direction="inline"
                    alignItems="center"
                    justifyContent="space-between"
                    inlineSize="100%"
                  >
                    <s-stack direction="inline" alignItems="center" gap="base">
                      <s-text>{blog.title}</s-text>
                      <s-badge><code>{blog.handle}</code></s-badge>
                      <s-badge>{articles.length} articles</s-badge>
                    </s-stack>
                    {isBlogOpen ? <s-icon type="caret-up"/> : <s-icon type="caret-down"/>}
                  </s-stack>
                </s-clickable>

                {isBlogOpen && (
                <s-stack
                  padding="small"
                  background="base"
                  borderRadius="none none base base"
                  gap="small"
                >
                  {articles.map((articleEdge) => {
                    const article = articleEdge.node;
                    const isArticleOpen = openArticles[article.id] ?? false;

                    return (
                      <ArticleImageAltEditor 
                        key={article.id}
                        article={article}
                        isArticleOpen={isArticleOpen}
                        onToggleArticle={() => toggleArticle(blog.id, article.id)}
                      />
                    );
                  })}

                  {articles.length === 0 && (
                    <p style={{ color: "#999", fontStyle: "italic" }}>No articles</p>
                  )}
                </s-stack>
              )}
              </s-stack>
            );
          })}

          {blogs.length === 0 && <s-text color="subdued"><em>No blogs found</em></s-text>}
        </s-stack>
      </s-section>

      {/* ── Metaobjects ── */}
      <s-section>
        <s-heading>
          Metaobjects ({metaobjectGroups.length} types)
        </s-heading>

        <s-stack direction="block" gap="base">
          {metaobjectGroups.map((group) => (
            <MetaobjectGroupView 
              key={group.type} 
              group={group}
              isOpen={openMetaobjectIds[group.type] ?? false}
              onToggle={() => toggleMetaobjectGroup(group.type)}
            />
          ))}

          {metaobjectGroups.length === 0 && (
            <s-text color="subdued"><em>No metaobjects found</em></s-text>
          )}
        </s-stack>
      </s-section>

      {/* ── Pages ── */}
      <s-section>
        <s-stack gap="base">
          <s-heading>
            <s-stack direction="inline" alignItems="center" justifyContent="space-between">
            Pages ({pages.length})
            {allImportablePages.length > 0 && (
              <s-button
                onClick={(e) => {
                  e.preventDefault();
                  handleImportAllPageImages();
                }}
                disabled={isImportingAllPages}
              >
                {isImportingAllPages
                  ? "Importing…"
                  : `Import All Page Images (${allImportablePages.reduce((sum, p) => sum + p.images.length, 0)})`}
              </s-button>
            )}
            </s-stack>
          </s-heading>
          

          {((pageBatchFetcher.data as any)?.errors?.length ?? 0) > 0 && (
            <s-banner heading="Error" tone="critical">
              {(pageBatchFetcher.data as any).errors.map((e: string, i: number) => (
                <s-text key={i}><s-icon type="alert-triangle"/> {e}</s-text>
              ))}
            </s-banner>
          )}

          <s-stack gap="small">
            {pages.map((pageEdge) => (
              <PageImageMigrationEditor
                key={pageEdge.node.id}
                page={pageEdge.node}
                body={pageBodies[pageEdge.node.id] ?? pageEdge.node.body ?? ""}
                onBodyUpdated={handlePageBodyUpdated}
              />
            ))}

            {pages.length === 0 && (
              <s-text color="subdued"><em>No pages found</em></s-text>
            )}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

/* =========================
   METAOBJECT GROUP VIEW
========================= */

function MetaobjectGroupView({ group, isOpen, onToggle }: { group: MetaobjectGroup; isOpen: boolean; onToggle: () => void }) {
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

      {batchData?.errors?.length > 0 && (
        <div style={{ padding: "0.4rem 1rem", color: "red", fontSize: "0.8rem" }}>
          {batchData.errors.map((e: string, i: number) => <div key={i}>⚠ {e}</div>)}
        </div>
      )}

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
            group.entries.map((entry) => (
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

/* =========================
   METAOBJECT ENTRY VIEW
========================= */

function MetaobjectEntryView({
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

/* =========================
   METAOBJECT FIELD ROW
========================= */

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg)(\?.*)?$/i;

function isExternalImageUrl(value: string | null): boolean {
  if (!value) return false;
  return IMAGE_EXTENSIONS.test(value) && !value.includes("cdn.shopify.com");
}

function MetaobjectFieldRow({
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

/* =========================
   PAGE IMAGE MIGRATION
========================= */

function PageImageMigrationEditor({
  page,
  body,
  onBodyUpdated,
}: {
  page: PageNode;
  body: string;
  onBodyUpdated: (pageId: string, updatedBody: string) => void;
}) {
  const importFetcher = useFetcher();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [importErrors, setImportErrors] = useState<Record<number, string>>({});

  const images = extractImagesFromHtml(body);
  const externalCount = images.filter((img) => isExternalImageUrl(img.src)).length;
  const isImporting = importFetcher.state !== "idle";

  const prevImportState = React.useRef(importFetcher.state);
  useEffect(() => {
    const prev = prevImportState.current;
    prevImportState.current = importFetcher.state;

    if (prev !== "idle" && importFetcher.state === "idle" && importFetcher.data) {
      const data = importFetcher.data as any;
      const completedIndex = importingIndex;

      if (data.success && data.pageId === page.id) {
        onBodyUpdated(page.id, data.updatedBody);
        if (completedIndex !== null) {
          setImportErrors((cur) => {
            const next = { ...cur };
            delete next[completedIndex];
            return next;
          });
        }
      } else if (data.success === false && completedIndex !== null) {
        setImportErrors((cur) => ({
          ...cur,
          [completedIndex]: data.error ?? "Import failed",
        }));
      }

      setImportingIndex(null);
    }
  }, [importFetcher.state, importFetcher.data, importingIndex, page.id, onBodyUpdated]);

  function importImage(index: number) {
    setImportingIndex(index);
    setImportErrors((cur) => {
      const next = { ...cur };
      delete next[index];
      return next;
    });

    importFetcher.submit(
      {
        intent: "importPageImage",
        pageId: page.id,
        imgSrc: images[index].src,
        imgIndex: String(index),
        body,
      },
      { method: "post" }
    );
  }

  return (
    <s-stack
      background="subdued"
      borderWidth="base"
      borderRadius="base"
    >
      <s-clickable 
        borderRadius="base"
        padding="base"
        onClick={() => setIsOpen(!isOpen)}
      >
        <s-stack
          direction="inline"
          alignItems="center"
          justifyContent="space-between"
          inlineSize="100%"
        >
          <s-stack direction="inline" alignItems="center" gap="base">
            {page.title}
            <s-badge>
              <code style={{ fontSize: "0.78rem" }}>{page.handle}</code>
            </s-badge>
            <s-badge>{images.length} images</s-badge>
            <s-badge>{externalCount} external</s-badge>
          </s-stack>
          {isOpen ? <s-icon type="caret-up"/> : <s-icon type="caret-down"/>}
        </s-stack>
      </s-clickable>

      {isOpen && (
        <s-stack
          padding="small"
          background="base"
          borderRadius="none none base base"
          gap="small"
        >
        {images.length === 0 ? (
          <s-text color="subdued"><em>No images found</em></s-text>
        ) : (
          images.map((img, i) => {
            const alreadyOnCdn = img.src.includes("cdn.shopify.com");
            return (
              <s-stack 
                padding="base"
                borderRadius="base"
                borderWidth="base"
                gap="base"
              >
                <s-grid
                  key={i}
                  gridTemplateColumns="100px 1fr"
                  gap="base"
                  alignItems="center"
                >
                  <s-image
                    src={img.src}
                    alt={img.alt}
                    aspectRatio="1/1"
                    borderRadius="base"
                  />

                  <s-stack gap="base">
                    <s-text>
                      {img.src}
                    </s-text>

                    <s-stack direction="inline" alignItems="center" gap="base">
                      {alreadyOnCdn ? (
                        <s-text tone="success">
                          ✓ Already on Shopify CDN
                        </s-text>
                      ) : (
                        <s-button
                          onClick={() => importImage(i)}
                          disabled={isImporting}
                        >
                          {importingIndex === i && isImporting ? "Importing…" : "Import to Shopify CDN"}
                        </s-button>
                      )}

                      {importErrors[i] && (
                        <s-text tone="critical">{importErrors[i]}</s-text>
                      )}
                    </s-stack>
                  </s-stack>
                </s-grid>
              </s-stack>
            );
          })
        )}
      </s-stack>
      )}
    </s-stack>
  );
}

/* =========================
   STYLES
========================= */

const sectionStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  overflow: "hidden",
};

const summaryStyle: React.CSSProperties = {
  padding: "0.85rem 1.25rem",
  fontWeight: 600,
  fontSize: "1.05rem",
  cursor: "pointer",
  backgroundColor: "#f3f4f6",
  userSelect: "none",
  listStyle: "none",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};

const nestedSectionStyle: React.CSSProperties = {
  marginBottom: "0.5rem",
  border: "1px solid #e5e7eb",
  borderRadius: "6px",
  overflow: "hidden",
};

const articleSectionStyle: React.CSSProperties = {
  marginBottom: "0.4rem",
  border: "1px solid #ede9fe",
  borderRadius: "5px",
  overflow: "hidden",
};

const nestedSummaryStyle: React.CSSProperties = {
  padding: "0.6rem 1rem",
  fontWeight: 500,
  cursor: "pointer",
  backgroundColor: "#f9fafb",
  userSelect: "none",
  listStyle: "none",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};

const clickableSummaryInnerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
};

const toggleIconStyle: React.CSSProperties = {
  marginLeft: "auto",
  color: "#6b7280",
  fontSize: "0.9rem",
  lineHeight: 1,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.88rem",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  backgroundColor: "#f3f4f6",
  borderBottom: "1px solid #e5e7eb",
  fontWeight: 600,
  color: "#374151",
};

const tdStyle: React.CSSProperties = {
  padding: "0.45rem 0.75rem",
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "middle",
};

/* =========================
   IMAGE EDITOR COMPONENT
========================= */

function extractImagesFromHtml(html?: string | null): ImgInfo[] {
  if (!html) return [];

  const tags = html.match(IMG_TAG_REGEX) ?? [];

  const readAttr = (tag: string, attr: "src" | "alt") => {
    const quoted = new RegExp(`\\b${attr}\\s*=\\s*([\"'])(.*?)\\1`, "i");
    const quotedMatch = tag.match(quoted);
    if (quotedMatch) return quotedMatch[2] ?? "";

    const unquoted = new RegExp(`\\b${attr}\\s*=\\s*([^\\s\"'=<>` + "`" + `]+)`, "i");
    const unquotedMatch = tag.match(unquoted);
    return unquotedMatch?.[1] ?? "";
  };

  return tags.map((tag, i) => ({
    src: readAttr(tag, "src"),
    alt: readAttr(tag, "alt"),
    index: i,
  }));
}

type ArticleImageAltEditorProps = {
  article: ArticleNode;
  isArticleOpen: boolean;
  onToggleArticle: () => void;
};

function ArticleImageAltEditor({
  article,
  isArticleOpen,
  onToggleArticle,
}: ArticleImageAltEditorProps) {
  const saveFetcher = useFetcher();
  const importFetcher = useFetcher();

  const [images, setImages] = useState<ImgInfo[]>([]);
  const [modifiedHtml, setModifiedHtml] = useState(article.body ?? "");
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [importErrors, setImportErrors] = useState<Record<number, string>>({});

  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setImages(extractImagesFromHtml(modifiedHtml));
  }, [modifiedHtml]);

  // ---- IMPORT IMAGE HANDLING ----
  const prevImportState = React.useRef(importFetcher.state);
  useEffect(() => {
    const prev = prevImportState.current;
    prevImportState.current = importFetcher.state;

    if (prev !== "idle" && importFetcher.state === "idle" && importFetcher.data) {
      const data = importFetcher.data as any;
      const completedIndex = importingIndex;

      if (data.success) {
        setModifiedHtml(data.updatedBody);
        if (completedIndex !== null) {
          setImportErrors((cur) => {
            const next = { ...cur };
            delete next[completedIndex];
            return next;
          });
        }
      } else {
        if (completedIndex !== null) {
          setImportErrors((cur) => ({
            ...cur,
            [completedIndex]: data.error ?? "Import failed",
          }));
        }
      }

      setImportingIndex(null);
    }
  }, [importFetcher.state, importFetcher.data, importingIndex]);

  // ---- SAVE ALT HANDLING ----
  const prevSaveState = React.useRef(saveFetcher.state);
  useEffect(() => {
    const prev = prevSaveState.current;
    prevSaveState.current = saveFetcher.state;

    if (prev !== "idle" && saveFetcher.state === "idle") {
      if (savingIndex !== null) {
        setSaveSuccess((prev) => ({
          ...prev,
          [savingIndex]: true,
        }));

        setTimeout(() => {
          setSaveSuccess((prev) => ({
            ...prev,
            [savingIndex!]: false,
          }));
        }, 2000);
      }

      setSavingIndex(null);
    }
  }, [saveFetcher.state, savingIndex]);

  function updateAlt(index: number, newAlt: string) {
    const doc = new DOMParser().parseFromString(modifiedHtml, "text/html");
    const imgs = Array.from(doc.getElementsByTagName("img"));
    if (!imgs[index]) return;

    imgs[index].setAttribute("alt", newAlt);
    setModifiedHtml(doc.body.innerHTML);
  }

  function saveAltToShopify(index: number) {
    setSavingIndex(index);

    saveFetcher.submit(
      {
        articleId: article.id,
        body: modifiedHtml,
      },
      { method: "post" }
    );
  }

  function importImage(index: number) {
    setImportingIndex(index);

    setImportErrors((cur) => {
      const next = { ...cur };
      delete next[index];
      return next;
    });

    importFetcher.submit(
      {
        intent: "importImage",
        articleId: article.id,
        imgSrc: images[index].src,
        imgIndex: String(index),
        body: modifiedHtml,
      },
      { method: "post" }
    );
  }

  const missingAltCount = images.filter(
    (i) => !i.alt || i.alt.trim() === ""
  ).length;

  const isShopifyCdn = (src: string) => src.includes("cdn.shopify.com");
  const isImporting = importFetcher.state !== "idle";

  function stripHtml(html: any) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.innerText || '';
  }

  const summaryText = stripHtml(article.summary);

  return (
    <s-box 
      key={article.id}
      background="base"
      borderRadius="base"
      borderWidth="base"
    >
      <s-clickable
        id={`article-toggle-${article.id}`}
        onClick={onToggleArticle}
        padding="small"
        borderRadius="base"
      >
        <s-stack direction="inline" alignItems="center" justifyContent="space-between" inlineSize="100%">
          <s-stack direction="inline" alignItems="center" justifyContent="center" gap="base">
            <s-text>{article.title}</s-text>
            <s-badge>Images missing alt text: { missingAltCount }</s-badge>
          </s-stack>
          {isArticleOpen ? <s-icon type="caret-up"/> : <s-icon type="caret-down"/>}
        </s-stack>
      </s-clickable>

      {isArticleOpen && (
        <s-stack 
          padding="base"
          gap="base"
        >
          {article.summary && (
            <s-text>{ summaryText }</s-text>
          )}

            {images.map((img, i) => {
              const isSaving = savingIndex === i;
              const isChanged = img.alt !== extractImagesFromHtml(article.body ?? "")[i]?.alt;

              return (
                <s-grid
                  key={i}
                  gridTemplateColumns="130px 1fr"
                  gap="base"
                  alignItems="center"
                >
                  {/* IMAGE */}
                  <s-image
                    src={img.src}
                    alt={img.alt}
                    aspectRatio="1/1"
                    borderRadius="base"
                  />

                  <s-stack gap="small">
                    {/* LABEL */}
                    <s-heading>Alt Text</s-heading>

                    {/* INPUT + SAVE */}
                    <s-stack direction="inline" alignItems="center" gap="base" inlineSize="100%">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <s-text-field
                          value={img.alt}
                          onChange={(e: any) => updateAlt(i, e.currentTarget.value)}
                          placeholder="Describe the image for accessibility..."
                        />
                      </div>

                      <s-button
                        onClick={() => saveAltToShopify(i)}
                        disabled={!isChanged || isSaving}
                      >
                        {isSaving ? "Saving..." : "Save"}
                      </s-button>
                    </s-stack>

                    {/* SUCCESS */}
                    {saveSuccess[i] && (
                      <s-text
                        tone="success"
                      >
                        ✓ Saved
                      </s-text>
                    )}

                    {/* IMAGE SRC */}
                    <s-text>
                      {img.src}
                    </s-text>

                    {/* IMPORT BUTTON */}
                    {isShopifyCdn(img.src) ? (
                      <s-text
                        tone="success"
                      >
                        ✓ Already on Shopify CDN
                      </s-text>
                    ) : (
                      <s-stack direction="inline" alignItems="center" gap="small"
                      >
                        <s-button
                          onClick={() => importImage(i)}
                          disabled={isImporting}
                        >
                          {importingIndex === i && isImporting
                            ? "Importing…"
                            : "Import to Shopify CDN"}
                        </s-button>

                        {importErrors[i] && (
                          <s-text tone="warning">
                            {importErrors[i]}
                          </s-text>
                        )}
                      </s-stack>
                    )}
                  </s-stack>
                </s-grid>
              );
            })}
        </s-stack>
      )}
    </s-box>
  );
}