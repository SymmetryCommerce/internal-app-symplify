import type { BlogEdge, ArticleEdge } from "../types";
import { ArticleImageAltEditor } from "./ArticleImageAltEditor";

interface BlogsSectionProps {
  blogs: BlogEdge[];
  openBlogIds: Record<string, boolean>;
  openArticleIds: Record<string, Record<string, boolean>>;
  onToggleBlog: (blogId: string) => void;
  onToggleArticle: (blogId: string, articleId: string) => void;
}

export function BlogsSection({
  blogs,
  openBlogIds,
  openArticleIds,
  onToggleBlog,
  onToggleArticle,
}: BlogsSectionProps) {
  return (
    <s-section>
      <s-heading>Blogs ({blogs.length})</s-heading>

      <s-stack direction="block" gap="base">
        {blogs.map((blogEdge) => {
          const blog = blogEdge.node;
          const articles = blog.articles?.edges ?? [];
          const isBlogOpen = openBlogIds[blog.id] ?? false;
          const openArticles = openArticleIds[blog.id] ?? {};

          return (
            <s-stack
              key={blog.id}
              id={`blog-toggle-${blog.id}`}
              background="subdued"
              borderWidth="base"
              borderRadius="base"
            >
              <s-clickable
                borderRadius="base"
                padding="small"
                onClick={() => onToggleBlog(blog.id)}
              >
                <s-stack
                  direction="inline"
                  alignItems="center"
                  justifyContent="space-between"
                  inlineSize="100%"
                >
                  <s-stack direction="inline" alignItems="center" gap="base">
                    <s-text>{blog.title}</s-text>
                    <s-badge>
                      <code>{blog.handle}</code>
                    </s-badge>
                    <s-badge>{articles.length} articles</s-badge>
                  </s-stack>
                  {isBlogOpen ? (
                    <s-icon type="caret-up" />
                  ) : (
                    <s-icon type="caret-down" />
                  )}
                </s-stack>
              </s-clickable>

              {isBlogOpen && (
                <s-stack
                  padding="small"
                  background="base"
                  borderRadius="none none base base"
                  gap="small"
                >
                  {articles.map((articleEdge: ArticleEdge) => {
                    const article = articleEdge.node;
                    const isArticleOpen = openArticles[article.id] ?? false;

                    return (
                      <ArticleImageAltEditor
                        key={article.id}
                        article={article}
                        isArticleOpen={isArticleOpen}
                        onToggleArticle={() =>
                          onToggleArticle(blog.id, article.id)
                        }
                      />
                    );
                  })}

                  {articles.length === 0 && (
                    <s-text color="subdued">
                      <em>No articles</em>
                    </s-text>
                  )}
                </s-stack>
              )}
            </s-stack>
          );
        })}

        {blogs.length === 0 && (
          <s-text color="subdued">
            <em>No blogs found</em>
          </s-text>
        )}
      </s-stack>
    </s-section>
  );
}
