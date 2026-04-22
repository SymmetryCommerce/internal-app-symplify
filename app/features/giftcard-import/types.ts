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

export type GiftCard = {
  id: string;
  lastCharacters: string | null;
  createdAt: string;
  balance: {
    amount: string;
    currencyCode: string;
  };
};

export type CsvGiftCardRow = {
  giftCardCode: string;
  initialValue: string;
  note: string;
};