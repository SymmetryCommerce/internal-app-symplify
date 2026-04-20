import { type LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

type DefinitionEdge = {
  node: {
    type: string;
    name: string;
  };
};

type DefinitionConnection = {
  edges: DefinitionEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

type MetaobjectNode = {
  id: string;
  handle: string;
  fields?: Array<{
    key: string;
    value: string | null;
  }>;
};

type MetaobjectEdge = {
  node: MetaobjectNode;
};

type MetaobjectConnection = {
  edges: MetaobjectEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

type ProductEdge = {
  node: {
    handle: string;
  };
};

type ProductConnection = {
  edges: ProductEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

type CollectionEdge = {
  node: {
    handle: string;
  };
};

type CollectionConnection = {
  edges: CollectionEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

type ArticleEdge = {
  node: {
    handle: string;
    blog: {
      handle: string;
    } | null;
  };
};

type ArticleConnection = {
  edges: ArticleEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

type PageEdge = {
  node: {
    handle: string;
  };
};

type PageConnection = {
  edges: PageEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

type ExportResource = "metaobjects" | "products" | "collections" | "articles" | "pages";

function isExportResource(value: string | null): value is ExportResource {
  return value === "metaobjects" || value === "products" || value === "collections" || value === "articles" || value === "pages";
}

function csvEscape(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

async function fetchAllDefinitionEdges(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]) {
  const allEdges: DefinitionEdge[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(
      `
      query GetMetaobjectDefinitions($after: String) {
        metaobjectDefinitions(first: 100, after: $after) {
          edges {
            node {
              type
              name
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      `,
      { variables: { after } }
    );

    const json: any = await response.json();
    const connection: DefinitionConnection | undefined = json?.data?.metaobjectDefinitions;
    const edges = connection?.edges ?? [];
    allEdges.push(...edges);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
  }

  return allEdges;
}

async function fetchAllMetaobjectsByType(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  type: string,
  includeFieldValues: boolean
) {
  const allEntries: MetaobjectNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(
      `
      query GetMetaobjectsByType($type: String!, $after: String, $includeFieldValues: Boolean!) {
        metaobjects(type: $type, first: 250, after: $after) {
          edges {
            node {
              id
              handle
              fields @include(if: $includeFieldValues) {
                key
                value
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      `,
      { variables: { type, after, includeFieldValues } }
    );

    const json: any = await response.json();
    const connection: MetaobjectConnection | undefined = json?.data?.metaobjects;
    const entries = (connection?.edges ?? []).map((edge) => edge.node);
    allEntries.push(...entries);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
  }

  return allEntries;
}

async function fetchAllProductHandles(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]) {
  const handles: string[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(
      `
      query GetProductHandles($after: String) {
        products(first: 250, after: $after) {
          edges {
            node {
              handle
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      `,
      { variables: { after } }
    );

    const json: any = await response.json();
    const connection: ProductConnection | undefined = json?.data?.products;
    const entries = (connection?.edges ?? []).map((edge) => edge.node.handle);
    handles.push(...entries);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
  }

  return handles;
}

async function fetchAllCollectionHandles(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]) {
  const handles: string[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(
      `
      query GetCollectionHandles($after: String) {
        collections(first: 250, after: $after) {
          edges {
            node {
              handle
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      `,
      { variables: { after } }
    );

    const json: any = await response.json();
    const connection: CollectionConnection | undefined = json?.data?.collections;
    const entries = (connection?.edges ?? []).map((edge) => edge.node.handle);
    handles.push(...entries);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
  }

  return handles;
}

async function fetchAllArticleHandlesWithBlogs(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]) {
  const entries: Array<{ blogHandle: string; handle: string }> = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(
      `
      query GetArticleHandles($after: String) {
        articles(first: 250, after: $after) {
          edges {
            node {
              handle
              blog {
                handle
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      `,
      { variables: { after } }
    );

    const json: any = await response.json();
    const connection: ArticleConnection | undefined = json?.data?.articles;
    const pageEntries = (connection?.edges ?? []).map((edge) => ({
      blogHandle: edge.node.blog?.handle ?? "",
      handle: edge.node.handle,
    }));
    entries.push(...pageEntries);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
  }

  return entries;
}

async function fetchAllPageHandles(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]) {
  const handles: string[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(
      `
      query GetPageHandles($after: String) {
        pages(first: 250, after: $after) {
          edges {
            node {
              handle
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      `,
      { variables: { after } }
    );

    const json: any = await response.json();
    const connection: PageConnection | undefined = json?.data?.pages;
    const entries = (connection?.edges ?? []).map((edge) => edge.node.handle);
    handles.push(...entries);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
  }

  return handles;
}

function buildHandleCsv(headers: string[], rows: string[][]) {
  const headerRow = headers.map(csvEscape).join(",");
  const dataRows = rows.map((row) => row.map(csvEscape).join(","));
  return [headerRow, ...dataRows].join("\n");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const requestUrl = new URL(request.url);
  const resourceParam = requestUrl.searchParams.get("resource");
  const resource: ExportResource = isExportResource(resourceParam) ? resourceParam : "metaobjects";
  const includeFieldValues = requestUrl.searchParams.get("includeFieldValues") === "1";
  const includeCommandColumn = requestUrl.searchParams.get("includeCommandColumn") === "1";

  if (resource === "products") {
    const handles = await fetchAllProductHandles(admin);
    const csv = buildHandleCsv(["handle"], handles.map((handle) => [handle]));
    const filename = `product-handles-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (resource === "collections") {
    const handles = await fetchAllCollectionHandles(admin);
    const csv = buildHandleCsv(["handle"], handles.map((handle) => [handle]));
    const filename = `collection-handles-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (resource === "articles") {
    const entries = await fetchAllArticleHandlesWithBlogs(admin);
    const csv = buildHandleCsv(
      ["Blog: Handle", "Handle"],
      entries.map((entry) => [entry.blogHandle, entry.handle])
    );
    const filename = `blog-post-handles-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (resource === "pages") {
    const handles = await fetchAllPageHandles(admin);
    const csv = buildHandleCsv(["handle"], handles.map((handle) => [handle]));
    const filename = `page-handles-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const definitionEdges = await fetchAllDefinitionEdges(admin);

  const rows: string[] = [];

  for (const { node: definition } of definitionEdges) {
    const entries = await fetchAllMetaobjectsByType(admin, definition.type, includeFieldValues);

    for (const entry of entries) {
      if (includeFieldValues) {
        const fields = entry.fields ?? [];

        if (fields.length === 0) {
          rows.push(
            [
              entry.handle,
              definition.type,
              ...(includeCommandColumn ? ["MERGE"] : []),
              definition.name,
              "",
              "",
            ]
              .map(csvEscape)
              .join(",")
          );
          continue;
        }

        for (const field of fields) {
          rows.push(
            [
              entry.handle,
              definition.type,
              ...(includeCommandColumn ? ["MERGE"] : []),
              definition.name,
              field.key,
              field.value ?? "",
            ]
              .map(csvEscape)
              .join(",")
          );
        }
      } else {
        rows.push(
          [
            entry.handle,
            definition.type,
            ...(includeCommandColumn ? ["MERGE"] : []),
            definition.name,
            "",
            "",
          ]
            .map(csvEscape)
            .join(",")
        );
      }
    }
  }

  const headerValues = ["Handle", "Definition: Handle", ...(includeCommandColumn ? ["Command"] : []), "Definition: Name", "Field", "Value"];
  const headerRow = headerValues.map(csvEscape).join(",");

  const csv = [headerRow, ...rows].join("\n");
  const filename = `metaobjects-export-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
