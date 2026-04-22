/* =========================
   TYPES
========================= */

export type ArticleNode = {
  id: string;
  title: string;
  handle?: string;
  body?: string;
  summary?: string;
};

export type ArticleEdge = {
  node: ArticleNode;
};

export type ArticlesConnection = {
  edges: ArticleEdge[];
};

export type BlogNode = {
  id: string;
  title: string;
  handle: string;
  articles?: ArticlesConnection;
};

export type BlogEdge = {
  node: BlogNode;
};

export type PageNode = {
  id: string;
  title: string;
  handle: string;
  body?: string;
};

export type PageEdge = {
  node: PageNode;
};

export type ImgInfo = {
  src: string;
  alt: string;
  index: number;
};

export type MetaobjectField = {
  key: string;
  value: string | null;
  type: string;
};

export type MetaobjectEntry = {
  id: string;
  handle: string;
  fields: MetaobjectField[];
};

export type MetaobjectGroup = {
  type: string;
  name: string;
  entries: MetaobjectEntry[];
};

export type ArticleImageAltEditorProps = {
  article: ArticleNode;
  isArticleOpen: boolean;
  onToggleArticle: () => void;
};
