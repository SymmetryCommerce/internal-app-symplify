import { useState } from "react";

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
