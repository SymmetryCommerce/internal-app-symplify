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
  type: string
) {
  const allEntries: MetaobjectNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(
      `
      query GetMetaobjectsByType($type: String!, $after: String) {
        metaobjects(type: $type, first: 250, after: $after) {
          edges {
            node {
              id
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
      { variables: { type, after } }
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const definitionEdges = await fetchAllDefinitionEdges(admin);

  const rows: string[] = [];

  for (const { node: definition } of definitionEdges) {
    const entries = await fetchAllMetaobjectsByType(admin, definition.type);

    for (const entry of entries) {
      rows.push([definition.type, definition.name, entry.id, entry.handle].map(csvEscape).join(","));
    }
  }

  const headerRow = ["metaobjectType", "metaobjectName", "entryId", "entryHandle"]
    .map(csvEscape)
    .join(",");

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
