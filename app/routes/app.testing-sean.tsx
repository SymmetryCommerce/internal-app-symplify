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

/* =========================
   LOADER (READ)
========================= */

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<{ blogs: BlogEdge[] }> => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query GetBlogs {
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
    }
  `);

  const json = await response.json();

  return {
    blogs: json.data.blogs.edges,
  };
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

      return { success: true, newUrl, imgIndex, updatedBody };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
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
  const { blogs = [] } = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Blog Information</h1>

      {blogs.map((blogEdge) => {
        const blog = blogEdge.node;
        const articles = blog.articles?.edges ?? [];

        return (
          <div key={blog.id} style={{ marginBottom: "3rem" }}>
            <h2>{blog.title}</h2>
            <p>
              <strong>Handle:</strong> {blog.handle}
            </p>

            {articles.map((articleEdge) => {
              const article = articleEdge.node;

              return (
                <>
                  <s-section heading="Multiple pages" key={article.id}>
                    <h3>{article.title}</h3>
                    <p>{article.summary}</p>

                    <ArticleImageAltEditor article={article} />
                  </s-section>
                  <br></br>
                </>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

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
  const [importError, setImportError] = useState<string | null>(null);

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
      if (data.success) {
        setModifiedHtml(data.updatedBody);
        setImportError(null);
      } else {
        setImportError(data.error ?? "Import failed");
      }
      setImportingIndex(null);
    }
  }, [importFetcher.state, importFetcher.data]);

  function updateAlt(index: number, newAlt: string) {
    const doc = new DOMParser().parseFromString(modifiedHtml, "text/html");
    const imgs = Array.from(doc.getElementsByTagName("img"));
    if (!imgs[index]) return;
    imgs[index].setAttribute("alt", newAlt);
    setModifiedHtml(doc.body.innerHTML);
  }

  function importImage(index: number) {
    setImportingIndex(index);
    setImportError(null);
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
            )}

            {importingIndex === i && importError && (
              <p style={{ color: "red", fontSize: "0.8rem", marginTop: "0.4rem" }}>
                ⚠ {importError}
              </p>
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