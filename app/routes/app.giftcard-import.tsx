import React from "react";
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

type CsvGiftCardRow = {
  giftCardCode: string;
  initialValue: string;
  note: string;
};

const REQUIRED_GIFT_CARD_CSV_HEADERS = [
  "Gift card code",
  "Initial value",
  "Note",
] as const;

const parseCsvContent = (csvContent: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows
    .map((currentRow) => currentRow.map((currentCell) => currentCell.trim()))
    .filter((currentRow) => currentRow.some((currentCell) => currentCell.length > 0));
};

const validateGiftCardCsvRows = (
  csvRows: string[][]
):
  | { ok: true; rows: CsvGiftCardRow[] }
  | { ok: false; error: string; validationErrors?: string[] } => {
  if (csvRows.length === 0) {
    return { ok: false, error: "CSV file is empty." };
  }

  const [headerRow, ...dataRows] = csvRows;
  const headerMap = new Map<string, number>();

  headerRow.forEach((header, index) => {
    headerMap.set(header.trim(), index);
  });

  const missingHeaders = REQUIRED_GIFT_CARD_CSV_HEADERS.filter(
    (header) => !headerMap.has(header)
  );

  if (missingHeaders.length > 0) {
    return {
      ok: false,
      error: `CSV is missing required header(s): ${missingHeaders.join(", ")}. Expected headers: ${REQUIRED_GIFT_CARD_CSV_HEADERS.join(", ")}.`,
    };
  }

  if (dataRows.length === 0) {
    return { ok: false, error: "CSV has headers but no gift card rows." };
  }

  const codeIndex = headerMap.get("Gift card code")!;
  const valueIndex = headerMap.get("Initial value")!;
  const noteIndex = headerMap.get("Note")!;

  const rows: CsvGiftCardRow[] = [];
  const validationErrors: string[] = [];

  dataRows.forEach((row, rowIndex) => {
    const sheetRowNumber = rowIndex + 2;
    const giftCardCode = (row[codeIndex] ?? "").trim();
    const initialValue = (row[valueIndex] ?? "").trim();
    const note = (row[noteIndex] ?? "").trim();

    if (!giftCardCode) {
      validationErrors.push(`Row ${sheetRowNumber}: Gift card code is required.`);
    } else if (giftCardCode.length < 8) {
      validationErrors.push(
        `Row ${sheetRowNumber}: Gift card code must be at least 8 characters long.`
      );
    }

    const parsedValue = Number(initialValue);
    if (!initialValue) {
      validationErrors.push(`Row ${sheetRowNumber}: Initial value is required.`);
    } else if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      validationErrors.push(
        `Row ${sheetRowNumber}: Initial value must be a number greater than 0.`
      );
    }

    rows.push({ giftCardCode, initialValue, note });
  });

  if (validationErrors.length > 0) {
    return {
      ok: false,
      error: "CSV validation failed. Fix the issues listed below and try again.",
      validationErrors,
    };
  }

  return { ok: true, rows };
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

  /* ------ Import gift cards from CSV ------ */
  if (intent === "importGiftCardsCsv") {
    const csvFile = formData.get("csvFile");

    if (!(csvFile instanceof File)) {
      return {
        success: false,
        error:
          "Please upload a CSV file that includes the headers: Gift card code, Initial value, Note.",
      };
    }

    const csvText = await csvFile.text();
    const parsedRows = parseCsvContent(csvText);
    const validationResult = validateGiftCardCsvRows(parsedRows);

    if (!validationResult.ok) {
      return {
        success: false,
        error: validationResult.error,
        validationErrors: validationResult.validationErrors,
      };
    }

    const creationErrors: string[] = [];
    let createdCount = 0;

    for (let i = 0; i < validationResult.rows.length; i++) {
      const row = validationResult.rows[i];
      const sheetRowNumber = i + 2;

      const createRes = await admin.graphql(
        `
        mutation giftCardCreate($input: GiftCardCreateInput!) {
          giftCardCreate(input: $input) {
            giftCard {
              id
            }
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
              code: row.giftCardCode,
              initialValue: row.initialValue,
              note: row.note,
            },
          },
        }
      );

      const createJson = await createRes.json();
      const userErrors = createJson.data?.giftCardCreate?.userErrors ?? [];

      if (userErrors.length > 0) {
        creationErrors.push(`Row ${sheetRowNumber}: ${userErrors[0].message}`);
        continue;
      }

      createdCount += 1;
    }

    if (creationErrors.length > 0) {
      return {
        success: false,
        error: `Imported ${createdCount} gift card(s), but ${creationErrors.length} row(s) failed.`,
        validationErrors: creationErrors,
      };
    }

    return {
      success: true,
      importedCount: createdCount,
    };
  }

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
  const importGiftCardsFetcher = useFetcher();
  const addGiftCardData = addGiftCardFetcher.data as
    | { success?: boolean; error?: string; giftCardCode?: string }
    | undefined;
  const importGiftCardsData = importGiftCardsFetcher.data as
    | {
        success?: boolean;
        error?: string;
        importedCount?: number;
        validationErrors?: string[];
      }
    | undefined;

  return (
    <s-page heading="Gift Card Import">
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

      <s-section heading="Import Gift Cards (CSV)">
        <s-stack gap="small">
          <s-text color="subdued">
            Required headers: Gift card code, Initial value, Note
          </s-text>

          <importGiftCardsFetcher.Form method="post" encType="multipart/form-data">
            <s-stack gap="small">
              <input type="hidden" name="intent" value="importGiftCardsCsv" />
              <label>
                <s-stack gap="none">
                  <s-text>CSV file</s-text>
                  <input
                    name="csvFile"
                    type="file"
                    accept=".csv,text/csv"
                    required
                  />
                </s-stack>
              </label>
              <s-button type="submit" disabled={importGiftCardsFetcher.state !== "idle"}>
                {importGiftCardsFetcher.state !== "idle" ? "Importing..." : "Import gift cards"}
              </s-button>
            </s-stack>
          </importGiftCardsFetcher.Form>

          {importGiftCardsData?.error && (
            <s-text tone="critical">{importGiftCardsData.error}</s-text>
          )}

          {importGiftCardsData?.validationErrors && importGiftCardsData.validationErrors.length > 0 && (
            <s-stack gap="none">
              {importGiftCardsData.validationErrors.map((errorMessage) => (
                <s-text key={errorMessage} tone="critical">
                  {errorMessage}
                </s-text>
              ))}
            </s-stack>
          )}

          {importGiftCardsData?.success && !importGiftCardsData.error && (
            <s-text tone="success">
              Successfully imported {importGiftCardsData.importedCount ?? 0} gift card(s).
            </s-text>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
