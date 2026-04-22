import type { BlogEdge, MetaobjectGroup, GiftCard, MetaobjectEntry } from "../types";

export const loadGiftCardImportData = async (admin: any): Promise<{
  blogs: BlogEdge[];
  metaobjectGroups: MetaobjectGroup[];
  giftCards: GiftCard[];
}> => {
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
