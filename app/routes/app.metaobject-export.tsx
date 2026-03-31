import React from "react";
import {
  Form,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { authenticate } from "../shopify.server";

type MetaobjectDefinition = {
  type: string;
  name: string;
};

type MetaobjectField = {
  key: string;
  value: string | null;
};

type MetaobjectNode = {
  id: string;
  type: string;
  handle: string;
  displayName: string | null;
  updatedAt: string;
  fields: MetaobjectField[];
};

type GraphqlPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

const DEF_PAGE_SIZE = 100;
const METAOBJECT_PAGE_SIZE = 250;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

async function graphqlJson<T>(
  admin: any,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }

  return json as T;
}

async function fetchAllDefinitions(admin: any): Promise<MetaobjectDefinition[]> {
  const definitions: MetaobjectDefinition[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    type DefinitionsResponse = {
      data: {
        metaobjectDefinitions: {
          edges: { node: MetaobjectDefinition }[];
          pageInfo: GraphqlPageInfo;
        };
      };
    };

    const json = await graphqlJson<DefinitionsResponse>(
      admin,
      `
      query MetaobjectDefinitions($first: Int!, $after: String) {
        metaobjectDefinitions(first: $first, after: $after) {
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
      { first: DEF_PAGE_SIZE, after },
    );

    const page = json.data.metaobjectDefinitions;
    definitions.push(...page.edges.map((edge) => edge.node));
    hasNextPage = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }

  return definitions;
}

async function fetchAllMetaobjectsForType(
  admin: any,
  type: string,
): Promise<MetaobjectNode[]> {
  const entries: MetaobjectNode[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    type MetaobjectsResponse = {
      data: {
        metaobjects: {
          edges: { node: MetaobjectNode; cursor: string }[];
          pageInfo: GraphqlPageInfo;
        };
      };
    };

    const json = await graphqlJson<MetaobjectsResponse>(
      admin,
      `
      query MetaobjectsByType($type: String!, $first: Int!, $after: String) {
        metaobjects(type: $type, first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              type
              handle
              displayName
              updatedAt
              fields {
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
      { type, first: METAOBJECT_PAGE_SIZE, after },
    );

    const page = json.data.metaobjects;
    entries.push(...page.edges.map((edge) => edge.node));
    hasNextPage = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }

  return entries;
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes("\r") || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) {
    return "ID,Type,Definition Name,Handle,Display Name,Updated At\n";
  }

  const headers = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row).forEach((key) => acc.add(key));
      return acc;
    }, new Set<string>()),
  );

  const orderedHeaders = [
    "ID",
    "Type",
    "Definition Name",
    "Handle",
    "Display Name",
    "Updated At",
    ...headers.filter(
      (h) =>
        h !== "ID" &&
        h !== "Type" &&
        h !== "Definition Name" &&
        h !== "Handle" &&
        h !== "Display Name" &&
        h !== "Updated At",
    ),
  ];

  const lines = [orderedHeaders.map(escapeCsv).join(",")];

  rows.forEach((row) => {
    lines.push(
      orderedHeaders
        .map((header) => escapeCsv(row[header] ?? ""))
        .join(","),
    );
  });

  return `${lines.join("\n")}\n`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "exportMetaobjects") {
    return new Response("Invalid intent", { status: 400 });
  }

  try {
    const definitions = await fetchAllDefinitions(admin);
    const definitionNameByType = new Map(definitions.map((def) => [def.type, def.name]));

    const rows: Record<string, string>[] = [];

    for (const definition of definitions) {
      const entries = await fetchAllMetaobjectsForType(admin, definition.type);

      entries.forEach((entry) => {
        const row: Record<string, string> = {
          ID: entry.id,
          Type: entry.type,
          "Definition Name": definitionNameByType.get(entry.type) ?? definition.type,
          Handle: entry.handle,
          "Display Name": entry.displayName ?? "",
          "Updated At": entry.updatedAt,
        };

        entry.fields.forEach((field) => {
          row[`Field:${field.key}`] = field.value ?? "";
        });

        rows.push(row);
      });
    }

    const csv = toCsv(rows);
    const timestamp = new Date().toISOString().replaceAll(":", "-");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="metaobjects-export-${timestamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to export metaobjects";
    return new Response(message, { status: 500 });
  }
};

export default function MetaobjectExport() {
  return (
    <div style={{ padding: "1rem", maxWidth: "700px" }}>
      <h1>Metaobject Export</h1>
      <p>
        Export all metaobjects across every definition as a CSV file. This uses cursor-based
        pagination and can export more than 1000 records.
      </p>

      <Form method="post">
        <input type="hidden" name="intent" value="exportMetaobjects" />
        <button type="submit">Export all metaobjects to CSV</button>
      </Form>
    </div>
  );
}
