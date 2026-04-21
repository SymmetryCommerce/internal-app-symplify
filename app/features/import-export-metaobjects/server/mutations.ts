import type { CsvMetaobjectEntry, ImportErrorLog, ImportSummary } from "../types";

type AdminClient = any; // TODO: Replace with proper Shopify Admin API type

export const findMetaobjectByHandle = async (
  admin: AdminClient,
  entry: CsvMetaobjectEntry,
) => {
  const lookupRes = await admin.graphql(
    `
    query GetMetaobjectByHandle($handle: MetaobjectHandleInput!) {
      metaobjectByHandle(handle: $handle) {
        id
        handle
      }
    }
    `,
    {
      variables: {
        handle: {
          type: entry.definitionHandle,
          handle: entry.handle,
        },
      },
    },
  );

  const lookupJson = await lookupRes.json();
  return lookupJson.data?.metaobjectByHandle as { id: string; handle: string } | null;
};

export const createMetaobject = async (
  admin: AdminClient,
  entry: CsvMetaobjectEntry,
) => {
  const createRes = await admin.graphql(
    `
    mutation CreateMetaobject($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        metaobject: {
          type: entry.definitionHandle,
          handle: entry.handle,
          fields: entry.fields,
        },
      },
    },
  );

  const createJson = await createRes.json();
  const createErrors = createJson.data?.metaobjectCreate?.userErrors ?? [];

  if (createErrors.length > 0) {
    throw new Error(createErrors[0].message);
  }
};

export const updateMetaobject = async (
  admin: AdminClient,
  entry: CsvMetaobjectEntry,
  id: string,
) => {
  const updateRes = await admin.graphql(
    `
    mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        id,
        metaobject: {
          fields: entry.fields,
        },
      },
    },
  );

  const updateJson = await updateRes.json();
  const updateErrors = updateJson.data?.metaobjectUpdate?.userErrors ?? [];

  if (updateErrors.length > 0) {
    throw new Error(updateErrors[0].message);
  }
};

export const deleteMetaobject = async (admin: AdminClient, id: string) => {
  const deleteRes = await admin.graphql(
    `
    mutation DeleteMetaobject($id: ID!) {
      metaobjectDelete(id: $id) {
        deletedId
        userErrors {
          field
          message
        }
      }
    }
    `,
    { variables: { id } },
  );

  const deleteJson = await deleteRes.json();
  const deleteErrors = deleteJson.data?.metaobjectDelete?.userErrors ?? [];

  if (deleteErrors.length > 0) {
    throw new Error(deleteErrors[0].message);
  }
};

export const getMetaobjectDefinition = async (admin: AdminClient, type: string) => {
  const definitionRes = await admin.graphql(
    `
    query MetaobjectDefinitionByType($type: String!) {
      metaobjectDefinitionByType(type: $type) {
        id
        type
      }
    }
    `,
    { variables: { type } },
  );

  const definitionJson = await definitionRes.json();
  return definitionJson.data?.metaobjectDefinitionByType;
};

interface ProcessMetaobjectsOptions {
  admin: AdminClient;
  entries: CsvMetaobjectEntry[];
}

export const processMetaobjectImport = async ({
  admin,
  entries,
}: ProcessMetaobjectsOptions) => {
  const definitionHandles = Array.from(new Set(entries.map((entry) => entry.definitionHandle)));
  const existingDefinitions = new Set<string>();
  const missingDefinitions = new Set<string>();
  const errorLogs: ImportErrorLog[] = [];

  for (const definitionHandle of definitionHandles) {
    try {
      const definition = await getMetaobjectDefinition(admin, definitionHandle);

      if (definition?.id) {
        existingDefinitions.add(definitionHandle);
      } else {
        missingDefinitions.add(definitionHandle);
      }
    } catch (error) {
      missingDefinitions.add(definitionHandle);
      errorLogs.push({
        definitionHandle,
        handle: "*",
        message:
          error instanceof Error
            ? `Failed to validate definition: ${error.message}`
            : "Failed to validate definition.",
      });
    }
  }

  const summary: ImportSummary = {
    totalMetaobjects: entries.length,
    updatedCount: 0,
    createdCount: 0,
    failedCount: 0,
  };

  for (const entry of entries) {
    if (entry.command === "IGNORE") {
      continue;
    }

    if (
      missingDefinitions.has(entry.definitionHandle) ||
      !existingDefinitions.has(entry.definitionHandle)
    ) {
      summary.failedCount += 1;
      errorLogs.push({
        definitionHandle: entry.definitionHandle,
        handle: entry.handle,
        message: `Metaobject definition '${entry.definitionHandle}' does not exist.`,
      });
      continue;
    }

    try {
      const existingMetaobject = await findMetaobjectByHandle(admin, entry);

      if (entry.command === "NEW") {
        if (existingMetaobject?.id) {
          summary.failedCount += 1;
          errorLogs.push({
            definitionHandle: entry.definitionHandle,
            handle: entry.handle,
            message: "Metaobject already exists, so NEW command failed.",
          });
          continue;
        }

        await createMetaobject(admin, entry);
        summary.createdCount += 1;
        continue;
      }

      if (entry.command === "MERGE") {
        if (existingMetaobject?.id) {
          await updateMetaobject(admin, entry, existingMetaobject.id);
          summary.updatedCount += 1;
          continue;
        }

        await createMetaobject(admin, entry);
        summary.createdCount += 1;
        continue;
      }

      if (entry.command === "UPDATE") {
        if (!existingMetaobject?.id) {
          summary.failedCount += 1;
          errorLogs.push({
            definitionHandle: entry.definitionHandle,
            handle: entry.handle,
            message: "Metaobject was not found, so UPDATE command failed.",
          });
          continue;
        }

        await updateMetaobject(admin, entry, existingMetaobject.id);
        summary.updatedCount += 1;
        continue;
      }

      if (entry.command === "REPLACE") {
        if (existingMetaobject?.id) {
          await deleteMetaobject(admin, existingMetaobject.id);
        }

        await createMetaobject(admin, entry);
        summary.createdCount += 1;
        continue;
      }

      if (entry.command === "DELETE") {
        if (!existingMetaobject?.id) {
          summary.failedCount += 1;
          errorLogs.push({
            definitionHandle: entry.definitionHandle,
            handle: entry.handle,
            message: "Metaobject was not found, so DELETE command failed.",
          });
          continue;
        }

        await deleteMetaobject(admin, existingMetaobject.id);
        summary.updatedCount += 1;
      }
    } catch (error) {
      summary.failedCount += 1;
      errorLogs.push({
        definitionHandle: entry.definitionHandle,
        handle: entry.handle,
        message: error instanceof Error ? error.message : "Unknown import error.",
      });
    }
  }

  return { summary, errorLogs };
};
