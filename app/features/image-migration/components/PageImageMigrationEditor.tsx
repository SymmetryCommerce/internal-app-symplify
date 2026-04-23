/* =========================
   PAGE IMAGE MIGRATION
========================= */

import { useFetcher } from "react-router";
import { PageNode } from "../types";
import React, { useEffect, useState } from "react";
import { extractImagesFromHtml, isExternalImageUrl } from "../utils";

export function PageImageMigrationEditor({
  page,
  body,
  onBodyUpdated,
}: {
  page: PageNode;
  body: string;
  onBodyUpdated: (pageId: string, updatedBody: string) => void;
}) {
  const importFetcher = useFetcher();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [importErrors, setImportErrors] = useState<Record<number, string>>({});

  const images = extractImagesFromHtml(body);
  const externalCount = images.filter((img) => isExternalImageUrl(img.src)).length;
  const isImporting = importFetcher.state !== "idle";

  const prevImportState = React.useRef(importFetcher.state);
  useEffect(() => {
    const prev = prevImportState.current;
    prevImportState.current = importFetcher.state;

    if (prev !== "idle" && importFetcher.state === "idle" && importFetcher.data) {
      const data = importFetcher.data as any;
      const completedIndex = importingIndex;

      if (data.success && data.pageId === page.id) {
        onBodyUpdated(page.id, data.updatedBody);
        if (completedIndex !== null) {
          setImportErrors((cur) => {
            const next = { ...cur };
            delete next[completedIndex];
            return next;
          });
        }
      } else if (data.success === false && completedIndex !== null) {
        setImportErrors((cur) => ({
          ...cur,
          [completedIndex]: data.error ?? "Import failed",
        }));
      }

      setImportingIndex(null);
    }
  }, [importFetcher.state, importFetcher.data, importingIndex, page.id, onBodyUpdated]);

  function importImage(index: number) {
    setImportingIndex(index);
    setImportErrors((cur) => {
      const next = { ...cur };
      delete next[index];
      return next;
    });

    importFetcher.submit(
      {
        intent: "importPageImage",
        pageId: page.id,
        imgSrc: images[index].src,
        imgIndex: String(index),
        body,
      },
      { method: "post" }
    );
  }

  return (
    <s-stack
      background="subdued"
      borderWidth="base"
      borderRadius="base"
    >
      <s-clickable 
        borderRadius="base"
        padding="base"
        onClick={() => setIsOpen(!isOpen)}
      >
        <s-stack
          direction="inline"
          alignItems="center"
          justifyContent="space-between"
          inlineSize="100%"
        >
          <s-stack direction="inline" alignItems="center" gap="base">
            {page.title}
            <s-badge>
              <code style={{ fontSize: "0.78rem" }}>{page.handle}</code>
            </s-badge>
            <s-badge>{images.length} images</s-badge>
            <s-badge>{externalCount} external</s-badge>
          </s-stack>
          {isOpen ? <s-icon type="caret-up"/> : <s-icon type="caret-down"/>}
        </s-stack>
      </s-clickable>

      {isOpen && (
        <s-stack
          padding="small"
          background="base"
          borderRadius="none none base base"
          gap="small"
        >
        {images.length === 0 ? (
          <s-text color="subdued"><em>No images found</em></s-text>
        ) : (
          images.map((img, i) => {
            const alreadyOnCdn = img.src.includes("cdn.shopify.com");
            return (
              <s-stack 
                padding="base"
                borderRadius="base"
                borderWidth="base"
                gap="base"
              >
                <s-grid
                  key={i}
                  gridTemplateColumns="100px 1fr"
                  gap="base"
                  alignItems="center"
                >
                  <s-image
                    src={img.src}
                    alt={img.alt}
                    aspectRatio="1/1"
                    borderRadius="base"
                  />

                  <s-stack gap="base">
                    <s-text>
                      {img.src}
                    </s-text>

                    <s-stack direction="inline" alignItems="center" gap="base">
                      {alreadyOnCdn ? (
                        <s-text tone="success">
                          ✓ Already on Shopify CDN
                        </s-text>
                      ) : (
                        <s-button
                          onClick={() => importImage(i)}
                          disabled={isImporting}
                        >
                          {importingIndex === i && isImporting ? "Importing…" : "Import to Shopify CDN"}
                        </s-button>
                      )}

                      {importErrors[i] && (
                        <s-text tone="critical">{importErrors[i]}</s-text>
                      )}
                    </s-stack>
                  </s-stack>
                </s-grid>
              </s-stack>
            );
          })
        )}
      </s-stack>
      )}
    </s-stack>
  );
}