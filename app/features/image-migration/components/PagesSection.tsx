import type { FetcherWithComponents } from "react-router";
import type { PageEdge } from "../types";
import { PageImageMigrationEditor } from "./PageImageMigrationEditor";

interface PagesSectionProps {
  pages: PageEdge[];
  pageBodies: Record<string, string>;
  onBodyUpdated: (pageId: string, updatedBody: string) => void;
  isImportingAllPages: boolean;
  allImportablePages: {
    pageId: string;
    body: string;
    images: { index: number; src: string }[];
  }[];
  onImportAllPageImages: () => void;
  fetcher: FetcherWithComponents<any>;
}

export function PagesSection({
  pages,
  pageBodies,
  onBodyUpdated,
  isImportingAllPages,
  allImportablePages,
  onImportAllPageImages,
  fetcher,
}: PagesSectionProps) {
  return (
    <s-section>
      <s-stack gap="base">
        <s-heading>
          <s-stack
            direction="inline"
            alignItems="center"
            justifyContent="space-between"
          >
            Pages ({pages.length})
            {allImportablePages.length > 0 && (
              <s-button
                onClick={(e) => {
                  e.preventDefault();
                  onImportAllPageImages();
                }}
                disabled={isImportingAllPages}
              >
                {isImportingAllPages
                  ? "Importing…"
                  : `Import All Page Images (${allImportablePages.reduce((sum, p) => sum + p.images.length, 0)})`}
              </s-button>
            )}
          </s-stack>
        </s-heading>

        <s-box>
          {((fetcher.data as any)?.errors?.length ?? 0) > 0 && (
            <s-banner heading="Error" tone="critical">
              {(fetcher.data as any).errors.map((e: string, i: number) => (
                <s-text key={i}>{e}</s-text>
              ))}
            </s-banner>
          )}
        </s-box>

        <s-stack gap="small">
          {pages.map((pageEdge) => (
            <PageImageMigrationEditor
              key={pageEdge.node.id}
              page={pageEdge.node}
              body={
                pageBodies[pageEdge.node.id] ?? pageEdge.node.body ?? ""
              }
              onBodyUpdated={onBodyUpdated}
            />
          ))}

          {pages.length === 0 && (
            <s-text color="subdued">
              <em>No pages found</em>
            </s-text>
          )}
        </s-stack>
      </s-stack>
    </s-section>
  );
}
