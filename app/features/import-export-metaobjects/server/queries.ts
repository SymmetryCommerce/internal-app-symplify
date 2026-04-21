/**
 * GraphQL queries for exporting data
 */

import type { DefinitionEdge, DefinitionConnection, MetaobjectConnection, MetaobjectNode, ProductConnection, CollectionConnection, ArticleConnection, PageConnection } from "../types";

type AdminClient = any; // TODO: Replace with proper Shopify Admin API type

export async function fetchAllDefinitionEdges(admin: AdminClient) {
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

export async function fetchAllMetaobjectsByType(
  admin: AdminClient,
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

export async function fetchAllProductHandles(admin: AdminClient) {
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

export async function fetchAllCollectionHandles(admin: AdminClient) {
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

export async function fetchAllArticleHandlesWithBlogs(admin: AdminClient) {
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

export async function fetchAllPageHandles(admin: AdminClient) {
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
    const entries = (connection?.edges ?? []).map((edge: any) => edge.node.handle);
    handles.push(...entries);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
  }

  return handles;
}
