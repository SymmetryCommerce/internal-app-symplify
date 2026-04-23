export type ExportResource = "products" | "collections" | "articles" | "pages" | "metaobjects";

export type HandleExportResource = Exclude<ExportResource, "metaobjects">;

export type CsvMetaobjectField = {
  key: string;
  value: string;
};

export type CsvMetaobjectEntry = {
  handle: string;
  definitionHandle: string;
  command: MetaobjectImportCommand;
  fields: CsvMetaobjectField[];
};

export type MetaobjectImportCommand =
  | "NEW"
  | "MERGE"
  | "UPDATE"
  | "REPLACE"
  | "DELETE"
  | "IGNORE";

export type ImportErrorLog = {
  definitionHandle: string;
  handle: string;
  message: string;
};

export type ImportSummary = {
  totalMetaobjects: number;
  updatedCount: number;
  createdCount: number;
  failedCount: number;
};

export type MetaobjectImportActionData = {
  success: boolean;
  error?: string;
  validationErrors?: string[];
  summary?: ImportSummary;
  errorLogs?: ImportErrorLog[];
};

export type DefinitionEdge = {
  node: {
    type: string;
    name: string;
  };
};

export type DefinitionConnection = {
  edges: DefinitionEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

export type MetaobjectNode = {
  id: string;
  handle: string;
  fields?: Array<{
    key: string;
    value: string | null;
  }>;
};

export type MetaobjectEdge = {
  node: MetaobjectNode;
};

export type MetaobjectConnection = {
  edges: MetaobjectEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

export type ProductEdge = {
  node: {
    handle: string;
  };
};

export type ProductConnection = {
  edges: ProductEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

export type CollectionEdge = {
  node: {
    handle: string;
  };
};

export type CollectionConnection = {
  edges: CollectionEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

export type ArticleEdge = {
  node: {
    handle: string;
    blog: {
      handle: string;
    } | null;
  };
};

export type ArticleConnection = {
  edges: ArticleEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

export type PageEdge = {
  node: {
    handle: string;
  };
};

export type PageConnection = {
  edges: PageEdge[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

export type ExportResourceType = "metaobjects" | "products" | "collections" | "articles" | "pages";