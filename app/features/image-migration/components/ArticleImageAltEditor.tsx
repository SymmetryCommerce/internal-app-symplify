import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { ArticleImageAltEditorProps, ImgInfo } from "../types";
import { extractImagesFromHtml } from "../utils";

export function ArticleImageAltEditor({
  article,
  isArticleOpen,
  onToggleArticle,
}: ArticleImageAltEditorProps) {
  const saveFetcher = useFetcher();
  const importFetcher = useFetcher();

  const [images, setImages] = useState<ImgInfo[]>([]);
  const [modifiedHtml, setModifiedHtml] = useState(article.body ?? "");
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [importErrors, setImportErrors] = useState<Record<number, string>>({});

  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setImages(extractImagesFromHtml(modifiedHtml));
  }, [modifiedHtml]);

  // ---- IMPORT IMAGE HANDLING ----
  const prevImportState = React.useRef(importFetcher.state);
  useEffect(() => {
    const prev = prevImportState.current;
    prevImportState.current = importFetcher.state;

    if (prev !== "idle" && importFetcher.state === "idle" && importFetcher.data) {
      const data = importFetcher.data as any;
      const completedIndex = importingIndex;

      if (data.success) {
        setModifiedHtml(data.updatedBody);
        if (completedIndex !== null) {
          setImportErrors((cur) => {
            const next = { ...cur };
            delete next[completedIndex];
            return next;
          });
        }
      } else {
        if (completedIndex !== null) {
          setImportErrors((cur) => ({
            ...cur,
            [completedIndex]: data.error ?? "Import failed",
          }));
        }
      }

      setImportingIndex(null);
    }
  }, [importFetcher.state, importFetcher.data, importingIndex]);

  // ---- SAVE ALT HANDLING ----
  const prevSaveState = React.useRef(saveFetcher.state);
  useEffect(() => {
    const prev = prevSaveState.current;
    prevSaveState.current = saveFetcher.state;

    if (prev !== "idle" && saveFetcher.state === "idle") {
      if (savingIndex !== null) {
        setSaveSuccess((prev) => ({
          ...prev,
          [savingIndex]: true,
        }));

        setTimeout(() => {
          setSaveSuccess((prev) => ({
            ...prev,
            [savingIndex!]: false,
          }));
        }, 2000);
      }

      setSavingIndex(null);
    }
  }, [saveFetcher.state, savingIndex]);

  function updateAlt(index: number, newAlt: string) {
    const doc = new DOMParser().parseFromString(modifiedHtml, "text/html");
    const imgs = Array.from(doc.getElementsByTagName("img"));
    if (!imgs[index]) return;

    imgs[index].setAttribute("alt", newAlt);
    setModifiedHtml(doc.body.innerHTML);
  }

  function saveAltToShopify(index: number) {
    setSavingIndex(index);

    saveFetcher.submit(
      {
        articleId: article.id,
        body: modifiedHtml,
      },
      { method: "post" }
    );
  }

  function importImage(index: number) {
    setImportingIndex(index);

    setImportErrors((cur) => {
      const next = { ...cur };
      delete next[index];
      return next;
    });

    importFetcher.submit(
      {
        intent: "importImage",
        articleId: article.id,
        imgSrc: images[index].src,
        imgIndex: String(index),
        body: modifiedHtml,
      },
      { method: "post" }
    );
  }

  const missingAltCount = images.filter(
    (i) => !i.alt || i.alt.trim() === ""
  ).length;

  const isShopifyCdn = (src: string) => src.includes("cdn.shopify.com");
  const isImporting = importFetcher.state !== "idle";

  function stripHtml(html: any) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.innerText || '';
  }

  const summaryText = stripHtml(article.summary);

  return (
    <s-box 
      key={article.id}
      background="base"
      borderRadius="base"
      borderWidth="base"
    >
      <s-clickable
        id={`article-toggle-${article.id}`}
        onClick={onToggleArticle}
        padding="small"
        borderRadius="base"
      >
        <s-stack direction="inline" alignItems="center" justifyContent="space-between" inlineSize="100%">
          <s-stack direction="inline" alignItems="center" justifyContent="center" gap="base">
            <s-text>{article.title}</s-text>
            <s-badge>Images missing alt text: { missingAltCount }</s-badge>
          </s-stack>
          {isArticleOpen ? <s-icon type="caret-up"/> : <s-icon type="caret-down"/>}
        </s-stack>
      </s-clickable>

      {isArticleOpen && (
        <s-stack 
          padding="base"
          gap="base"
        >
          {article.summary && (
            <s-text>{ summaryText }</s-text>
          )}

            {images.map((img, i) => {
              const isSaving = savingIndex === i;
              const isChanged = img.alt !== extractImagesFromHtml(article.body ?? "")[i]?.alt;

              return (
                <s-grid
                  key={i}
                  gridTemplateColumns="130px 1fr"
                  gap="base"
                  alignItems="center"
                >
                  {/* IMAGE */}
                  <s-image
                    src={img.src}
                    alt={img.alt}
                    aspectRatio="1/1"
                    borderRadius="base"
                  />

                  <s-stack gap="small">
                    {/* LABEL */}
                    <s-heading>Alt Text</s-heading>

                    {/* INPUT + SAVE */}
                    <s-stack direction="inline" alignItems="center" gap="base" inlineSize="100%">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <s-text-field
                          value={img.alt}
                          onChange={(e: any) => updateAlt(i, e.currentTarget.value)}
                          placeholder="Describe the image for accessibility..."
                        />
                      </div>

                      <s-button
                        onClick={() => saveAltToShopify(i)}
                        disabled={!isChanged || isSaving}
                      >
                        {isSaving ? "Saving..." : "Save"}
                      </s-button>
                    </s-stack>

                    {/* SUCCESS */}
                    {saveSuccess[i] && (
                      <s-text
                        tone="success"
                      >
                        ✓ Saved
                      </s-text>
                    )}

                    {/* IMAGE SRC */}
                    <s-text>
                      {img.src}
                    </s-text>

                    {/* IMPORT BUTTON */}
                    {isShopifyCdn(img.src) ? (
                      <s-text
                        tone="success"
                      >
                        ✓ Already on Shopify CDN
                      </s-text>
                    ) : (
                      <s-stack direction="inline" alignItems="center" gap="small"
                      >
                        <s-button
                          onClick={() => importImage(i)}
                          disabled={isImporting}
                        >
                          {importingIndex === i && isImporting
                            ? "Importing…"
                            : "Import to Shopify CDN"}
                        </s-button>

                        {importErrors[i] && (
                          <s-text tone="warning">
                            {importErrors[i]}
                          </s-text>
                        )}
                      </s-stack>
                    )}
                  </s-stack>
                </s-grid>
              );
            })}
        </s-stack>
      )}
    </s-box>
  );
}
