import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { PageEdge } from "./types";
import { extractImagesFromHtml, isExternalImageUrl } from "./utils";

/**
 * Manages UI state for image migration accordions/toggles
 * Handles: blog toggles, article toggles, metaobject group toggles
 */
export function useImageMigrationUI() {
  const [openBlogIds, setOpenBlogIds] = useState<Record<string, boolean>>({});
  const [openArticleIds, setOpenArticleIds] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [openMetaobjectIds, setOpenMetaobjectIds] = useState<Record<string, boolean>>({});

  function toggleBlog(blogId: string) {
    setOpenBlogIds((cur) => ({
      ...cur,
      [blogId]: !cur[blogId],
    }));
  }

  function toggleArticle(blogId: string, articleId: string) {
    setOpenArticleIds((cur) => ({
      ...cur,
      [blogId]: {
        ...(cur[blogId] ?? {}),
        [articleId]: !(cur[blogId]?.[articleId]),
      },
    }));
  }

  function toggleMetaobjectGroup(groupType: string) {
    setOpenMetaobjectIds((cur) => ({
      ...cur,
      [groupType]: !cur[groupType],
    }));
  }

  return {
    openBlogIds,
    toggleBlog,
    openArticleIds,
    toggleArticle,
    openMetaobjectIds,
    toggleMetaobjectGroup,
  };
}

/**
 * Manages page batch import state and logic
 * Handles: page body updates, batch import fetcher, all-importable calculation
 */
export function usePageBatchImport(pages: PageEdge[]) {
  const pageBatchFetcher = useFetcher();
  const [pageBodies, setPageBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(pages.map((edge) => [edge.node.id, edge.node.body ?? ""]))
  );

  const isImportingAllPages = pageBatchFetcher.state !== "idle";
  const prevPageBatchState = useRef(pageBatchFetcher.state);

  // Listen for batch import completion and update page bodies
  useEffect(() => {
    const prev = prevPageBatchState.current;
    prevPageBatchState.current = pageBatchFetcher.state;

    if (prev !== "idle" && pageBatchFetcher.state === "idle" && pageBatchFetcher.data) {
      const data = pageBatchFetcher.data as any;
      if (data.updatedPages?.length) {
        setPageBodies((cur) => {
          const next = { ...cur };
          for (const page of data.updatedPages) {
            next[page.pageId] = page.updatedBody;
          }
          return next;
        });
      }
    }
  }, [pageBatchFetcher.state, pageBatchFetcher.data]);

  // Calculate all pages with importable images
  const allImportablePages = pages
    .map((edge) => {
      const page = edge.node;
      const body = pageBodies[page.id] ?? page.body ?? "";
      const images = extractImagesFromHtml(body)
        .filter((img) => isExternalImageUrl(img.src))
        .map((img) => ({ index: img.index, src: img.src }));

      return { pageId: page.id, body, images };
    })
    .filter((p) => p.images.length > 0);

  function handleImportAllPageImages() {
    if (allImportablePages.length === 0) return;
    pageBatchFetcher.submit(
      {
        intent: "importAllPageImages",
        pages: JSON.stringify(allImportablePages),
      },
      { method: "post" }
    );
  }

  function handlePageBodyUpdated(pageId: string, updatedBody: string) {
    setPageBodies((cur) => ({
      ...cur,
      [pageId]: updatedBody,
    }));
  }

  return {
    pageBatchFetcher,
    pageBodies,
    isImportingAllPages,
    allImportablePages,
    handleImportAllPageImages,
    handlePageBodyUpdated,
  };
}
