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

/* =========================
   LOADER (READ)
========================= */

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<{
  blogs: BlogEdge[];
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

  return { blogs, metaobjectGroups };
};

/* =========================
   ACTION (WRITE)
========================= */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

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

export default function TestingPageSean() {
  const { blogs = [], metaobjectGroups = [] } =
    useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Content Overview</h1>

      {/* ── Blogs ── */}
      <details style={sectionStyle}>
        <summary style={summaryStyle}>
          📝 Blogs ({blogs.length})
        </summary>

        <div style={{ padding: "1rem 0" }}>
          {blogs.map((blogEdge) => {
            const blog = blogEdge.node;
            const articles = blog.articles?.edges ?? [];

            return (
              <details key={blog.id} style={nestedSectionStyle}>
                <summary style={nestedSummaryStyle}>
                  {blog.title}{" "}
                  <span style={badgeStyle}>{articles.length} articles</span>
                </summary>

                <div style={{ padding: "0.5rem 0 0.5rem 1rem" }}>
                  <p style={{ margin: "0 0 0.5rem", color: "#555", fontSize: "0.85rem" }}>
                    Handle: <code>{blog.handle}</code>
                  </p>

                  {articles.map((articleEdge) => {
                    const article = articleEdge.node;
                    return (
                      <details key={article.id} style={articleSectionStyle}>
                        <summary style={nestedSummaryStyle}>
                          {article.title}
                        </summary>
                        <div style={{ padding: "0.75rem 0 0.5rem 1rem" }}>
                          {article.summary && (
                            <p style={{ margin: "0 0 0.75rem", color: "#555" }}>
                              {article.summary}
                            </p>
                          )}
                          <ArticleImageAltEditor article={article} />
                        </div>
                      </details>
                    );
                  })}

                  {articles.length === 0 && (
                    <p style={{ color: "#999", fontStyle: "italic" }}>No articles</p>
                  )}
                </div>
              </details>
            );
          })}

          {blogs.length === 0 && (
            <p style={{ color: "#999", fontStyle: "italic" }}>No blogs found</p>
          )}
        </div>
      </details>

      {/* ── Metaobjects ── */}
      <details style={sectionStyle}>
        <summary style={summaryStyle}>
          🗂 Metaobjects ({metaobjectGroups.length} types)
        </summary>

        <div style={{ padding: "1rem 0" }}>
          {metaobjectGroups.map((group) => (
            <MetaobjectGroupView key={group.type} group={group} />
          ))}

          {metaobjectGroups.length === 0 && (
            <p style={{ color: "#999", fontStyle: "italic" }}>No metaobjects found</p>
          )}
        </div>
      </details>
    </div>
  );
}

/* =========================
   METAOBJECT GROUP VIEW
========================= */

function MetaobjectGroupView({ group }: { group: MetaobjectGroup }) {
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
    <details style={nestedSectionStyle}>
      <summary style={nestedSummaryStyle}>
        {group.name}{" "}
        <span style={badgeStyle}>
          <code style={{ fontSize: "0.78rem" }}>{group.type}</code>
        </span>{" "}
        <span style={badgeStyle}>{group.entries.length} entries</span>
        {allImportable.length > 0 && (
          <button
            onClick={(e) => { e.preventDefault(); handleImportAll(); }}
            disabled={isBatchImporting}
            style={{
              marginLeft: "auto",
              padding: "0.2rem 0.7rem",
              fontSize: "0.78rem",
              cursor: isBatchImporting ? "not-allowed" : "pointer",
              opacity: isBatchImporting ? 0.6 : 1,
            }}
          >
            {isBatchImporting
              ? "Importing…"
              : `Import All Images (${allImportable.length})`}
          </button>
        )}
      </summary>

      {batchData?.errors?.length > 0 && (
        <div style={{ padding: "0.4rem 1rem", color: "red", fontSize: "0.8rem" }}>
          {batchData.errors.map((e: string, i: number) => <div key={i}>⚠ {e}</div>)}
        </div>
      )}

      <div style={{ padding: "0.5rem 0 0.5rem 1rem" }}>
        {group.entries.length === 0 ? (
          <p style={{ color: "#999", fontStyle: "italic" }}>No entries</p>
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
      </div>
    </details>
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
  return (
    <details style={articleSectionStyle}>
      <summary style={nestedSummaryStyle}>
        <code style={{ fontSize: "0.82rem" }}>{entry.handle}</code>
      </summary>
      <div style={{ padding: "0.5rem 0 0.5rem 1rem" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Field</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Value</th>
            </tr>
          </thead>
          <tbody>
            {entry.fields.map((field) => (
              <MetaobjectFieldRow
                key={field.key}
                field={field}
                metaobjectId={entry.id}
                overrideValue={fieldValues[field.key]}
                onImported={onFieldUpdate}
              />
            ))}
          </tbody>
        </table>
      </div>
    </details>
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
        onImported?.(field.key, data.newUrl);
      }
    }
  }, [fetcher.state, fetcher.data, field.key, metaobjectId, onImported]);

  const showImportButton = isExternalImageUrl(currentValue);

  function handleImport() {
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
    <tr>
      <td style={tdStyle}>
        <code style={{ fontSize: "0.82rem" }}>{field.key}</code>
      </td>
      <td style={tdStyle}>
        <span style={typeBadgeStyle}>{field.type}</span>
      </td>
      <td style={{ ...tdStyle, wordBreak: "break-all", maxWidth: "320px" }}>
        {currentValue ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>{currentValue}</span>
            {showImportButton && (
              <button
                onClick={handleImport}
                disabled={isImporting}
                style={{
                  alignSelf: "flex-start",
                  padding: "0.2rem 0.6rem",
                  fontSize: "0.78rem",
                  cursor: isImporting ? "not-allowed" : "pointer",
                  opacity: isImporting ? 0.6 : 1,
                }}
              >
                {isImporting ? "Importing…" : "Import to Shopify CDN"}
              </button>
            )}
            {!showImportButton && currentValue.includes("cdn.shopify.com") && IMAGE_EXTENSIONS.test(currentValue) && (
              <span style={{ fontSize: "0.75rem", color: "#2e7d32", fontWeight: 600 }}>
                ✓ Already on Shopify CDN
              </span>
            )}
            {fetcher.state === "idle" && (fetcher.data as any)?.success === false && (
              <span style={{ fontSize: "0.78rem", color: "red" }}>
                ⚠ {(fetcher.data as any).error}
              </span>
            )}
          </div>
        ) : (
          <span style={{ color: "#aaa" }}>—</span>
        )}
      </td>
    </tr>
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

const badgeStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 400,
  color: "#6b7280",
  backgroundColor: "#e5e7eb",
  padding: "0.1rem 0.5rem",
  borderRadius: "999px",
};

const typeBadgeStyle: React.CSSProperties = {
  fontSize: "0.78rem",
  backgroundColor: "#ede9fe",
  color: "#5b21b6",
  padding: "0.1rem 0.5rem",
  borderRadius: "4px",
  fontFamily: "monospace",
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

  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = Array.from(doc.getElementsByTagName("img"));

  return imgs.map((img, i) => ({
    src: img.getAttribute("src") ?? "",
    alt: img.getAttribute("alt") ?? "",
    index: i,
  }));
}

function ArticleImageAltEditor({ article }: { article: ArticleNode }) {
  const saveFetcher = useFetcher();
  const importFetcher = useFetcher();

  const [images, setImages] = useState<ImgInfo[]>([]);
  const [modifiedHtml, setModifiedHtml] = useState(article.body ?? "");
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [importErrors, setImportErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    setImages(extractImagesFromHtml(modifiedHtml));
  }, [modifiedHtml]);

  // Detect when an import round-trip completes
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

  function updateAlt(index: number, newAlt: string) {
    const doc = new DOMParser().parseFromString(modifiedHtml, "text/html");
    const imgs = Array.from(doc.getElementsByTagName("img"));
    if (!imgs[index]) return;
    imgs[index].setAttribute("alt", newAlt);
    setModifiedHtml(doc.body.innerHTML);
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

  function saveToShopify() {
    saveFetcher.submit(
      { articleId: article.id, body: modifiedHtml },
      { method: "post" }
    );
  }

  const missingAltCount = images.filter(
    (i) => !i.alt || i.alt.trim() === ""
  ).length;
  const isShopifyCdn = (src: string) => src.includes("cdn.shopify.com");
  const isImporting = importFetcher.state !== "idle";

  return (
    <div style={{ marginTop: "1rem" }}>
      <p>
        <strong>Images missing alt text:</strong> {missingAltCount}
      </p>

      {images.map((img, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "flex-start",
            marginBottom: "1.5rem",
            padding: "1rem",
            backgroundColor: "#f9f9f9",
            borderRadius: "4px",
            border: "1px solid #e0e0e0",
          }}
        >
          <img
            src={img.src}
            alt={img.alt}
            style={{ width: 120, height: 80, objectFit: "contain", flexShrink: 0 }}
          />

          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              value={img.alt}
              onChange={(e) => updateAlt(i, e.target.value)}
              placeholder="Enter alt text"
              style={{ width: "100%", marginBottom: "0.75rem", boxSizing: "border-box" }}
            />

            {/* Source URL */}
            <p
              style={{
                fontSize: "0.78rem",
                color: "#555",
                wordBreak: "break-all",
                margin: "0 0 0.5rem 0",
                fontFamily: "monospace",
              }}
            >
              {img.src}
            </p>

            {/* CDN status / import button */}
            {isShopifyCdn(img.src) ? (
              <span style={{ fontSize: "0.8rem", color: "#2e7d32", fontWeight: 600 }}>
                ✓ Already on Shopify CDN
              </span>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  onClick={() => importImage(i)}
                  disabled={isImporting}
                  style={{
                    padding: "0.3rem 0.75rem",
                    cursor: isImporting ? "not-allowed" : "pointer",
                    opacity: isImporting ? 0.6 : 1,
                  }}
                >
                  {importingIndex === i && isImporting
                    ? "Importing…"
                    : "Import to Shopify CDN"}
                </button>
                {importErrors[i] && (
                  <span style={{ color: "red", fontSize: "0.8rem" }}>
                    {importErrors[i]}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      <button
        onClick={saveToShopify}
        disabled={saveFetcher.state !== "idle"}
        style={{
          marginTop: "1rem",
          padding: "0.5rem 1rem",
          cursor: saveFetcher.state !== "idle" ? "not-allowed" : "pointer",
          opacity: saveFetcher.state !== "idle" ? 0.6 : 1,
        }}
      >
        {saveFetcher.state !== "idle" ? "Saving…" : "Save to Shopify"}
      </button>
    </div>
  );
}
