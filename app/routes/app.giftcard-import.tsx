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

type GiftCard = {
  id: string;
  lastCharacters: string | null;
  createdAt: string;
  balance: {
    amount: string;
    currencyCode: string;
  };
};

/* =========================
   LOADER (READ)
========================= */

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<{
  blogs: BlogEdge[];
  metaobjectGroups: MetaobjectGroup[];
  giftCards: GiftCard[];
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
      metaobjectDefinitions(first: 20) {
        edges {
          node {
            type
            name
          }
        }
      }
      giftCards(first: 20) {
        edges {
          node {
            id
            lastCharacters
            createdAt
            balance {
              amount
              currencyCode
            }
          }
        }
      }
    }
  `);

  const firstJson = await firstRes.json();
  const blogs: BlogEdge[] = firstJson.data.blogs.edges;
  const definitionEdges: { node: { type: string; name: string } }[] =
    firstJson.data.metaobjectDefinitions.edges;
  const giftCards: GiftCard[] = firstJson.data.giftCards.edges.map(
    (edge: { node: GiftCard }) => edge.node
  );

  // Step 2: fetch actual metaobject entries for each type
  const metaobjectGroups: MetaobjectGroup[] = await Promise.all(
    definitionEdges.map(async ({ node: def }) => {
      const res = await admin.graphql(
        `
        query GetMetaobjects($type: String!) {
          metaobjects(type: $type, first: 20) {
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

  return { blogs, metaobjectGroups, giftCards };
};

/* =========================
   ACTION (WRITE)
========================= */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  /* ------ Create a gift card ------ */
  if (intent === "addGiftCard") {
    const giftCardCode = formData.get("giftCardCode") as string;
    const initialValue = formData.get("initialValue") as string;
    const note = formData.get("note") as string;

    const createRes = await admin.graphql(
      `
      mutation giftCardCreate($input: GiftCardCreateInput!) {
        giftCardCreate(input: $input) {
          giftCard {
            id
            initialValue {
              amount
            }
          }
          giftCardCode
          userErrors {
            message
            field
          }
        }
      }
      `,
      {
        variables: {
          input: {
            code: giftCardCode,
            initialValue,
            note,
          },
        },
      }
    );

    const createJson = await createRes.json();
    const createErrors = createJson.data.giftCardCreate.userErrors;

    if (createErrors?.length) {
      return {
        success: false,
        error: createErrors[0].message,
      };
    }

    return {
      success: true,
      giftCardCode: createJson.data.giftCardCreate.giftCardCode,
      giftCard: createJson.data.giftCardCreate.giftCard,
    };
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

      // 6. Swap old src → new CDN URL in the article HTML
      const updatedBody = body.split(imgSrc).join(newUrl);

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

export default function ImportPage() {
  const { blogs = [], metaobjectGroups = [], giftCards = [] } =
    useLoaderData<typeof loader>();
  const addGiftCardFetcher = useFetcher();
  const addGiftCardData = addGiftCardFetcher.data as
    | { success?: boolean; error?: string; giftCardCode?: string }
    | undefined;

  return (
    <div style={{ padding: "2rem" }}>
      <s-section heading="Gift Cards">
        <div style={{ display: "grid", gap: "1rem" }}>
          <div>
            <h3 style={{ margin: "0 0 0.5rem" }}>Existing Gift Cards</h3>
            {giftCards.length === 0 ? (
              <p style={{ margin: 0, color: "#666" }}>No gift cards found.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "0.4rem" }}>Code</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "0.4rem" }}>Amount</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "0.4rem" }}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {giftCards.map((giftCard) => (
                    <tr key={giftCard.id}>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "0.4rem" }}>
                        {`****${giftCard.lastCharacters ?? ""}`}
                      </td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "0.4rem" }}>
                        {giftCard.balance.amount} {giftCard.balance.currencyCode}
                      </td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "0.4rem" }}>
                        {new Date(giftCard.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5rem" }}>Add Gift Card</h3>
            <addGiftCardFetcher.Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "360px" }}>
              <input type="hidden" name="intent" value="addGiftCard" />
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Gift card code</span>
                <input name="giftCardCode" type="text" required />
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Initial value</span>
                <input name="initialValue" type="number" min="0.01" step="0.01" required />
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Note</span>
                <input name="note" type="text" />
              </label>
              <button type="submit" disabled={addGiftCardFetcher.state !== "idle"}>
                {addGiftCardFetcher.state !== "idle" ? "Adding..." : "Add gift card"}
              </button>
            </addGiftCardFetcher.Form>

            {addGiftCardData?.error && (
              <p style={{ color: "red", marginTop: "0.75rem" }}>{addGiftCardData.error}</p>
            )}
            {addGiftCardData?.success && !addGiftCardData.error && (
              <p style={{ color: "green", marginTop: "0.75rem" }}>
                Gift card created successfully ({addGiftCardData.giftCardCode ?? "code hidden"}). Refresh to see it in the list.
              </p>
            )}
          </div>
        </div>
      </s-section>
    </div>
  );
}
