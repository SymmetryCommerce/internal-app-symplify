/* =========================
   IMAGE EDITOR COMPONENT
========================= */

import { IMAGE_EXTENSIONS, IMG_TAG_REGEX } from "./constants";
import { ImgInfo } from "./types";

export function extractImagesFromHtml(html?: string | null): ImgInfo[] {
  if (!html) return [];

  const tags = html.match(IMG_TAG_REGEX) ?? [];

  const readAttr = (tag: string, attr: "src" | "alt") => {
    const quoted = new RegExp(`\\b${attr}\\s*=\\s*([\"'])(.*?)\\1`, "i");
    const quotedMatch = tag.match(quoted);
    if (quotedMatch) return quotedMatch[2] ?? "";

    const unquoted = new RegExp(`\\b${attr}\\s*=\\s*([^\\s\"'=<>` + "`" + `]+)`, "i");
    const unquotedMatch = tag.match(unquoted);
    return unquotedMatch?.[1] ?? "";
  };

  return tags.map((tag, i) => ({
    src: readAttr(tag, "src"),
    alt: readAttr(tag, "alt"),
    index: i,
  }));
}

/**
 * Check if an image URL is already on Shopify CDN
 */
export function isShopifyCdn(src: string): boolean {
  return src.includes("cdn.shopify.com");
}

/**
 * Count images with missing or empty alt text
 */
export function countMissingAlt(images: ImgInfo[]): number {
  return images.filter((i) => !i.alt || i.alt.trim() === "").length;
}

/**
 * Update alt text for a specific image in HTML
 */
export function updateImageAlt(
  html: string,
  imageIndex: number,
  newAlt: string
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = Array.from(doc.getElementsByTagName("img"));
  if (!imgs[imageIndex]) return html;

  imgs[imageIndex].setAttribute("alt", newAlt);
  return doc.body.innerHTML;
}

export function replaceImgSrcByIndex(html: string, targetIndex: number, newSrc: string): string {
  let currentIndex = -1;
  let replaced = false;

  const updated = html.replace(IMG_TAG_REGEX, (tag) => {
    currentIndex += 1;
    if (currentIndex !== targetIndex) return tag;

    replaced = true;
    const quotedSrcRegex = /\bsrc\s*=\s*(['"])(.*?)\1/i;
    if (quotedSrcRegex.test(tag)) {
      return tag.replace(quotedSrcRegex, (_m, quote: string) => `src=${quote}${newSrc}${quote}`);
    }

    const unquotedSrcRegex = /\bsrc\s*=\s*([^\s"'=<>`]+)/i;
    if (unquotedSrcRegex.test(tag)) {
      return tag.replace(unquotedSrcRegex, `src="${newSrc}"`);
    }

    if (tag.endsWith("/>")) return `${tag.slice(0, -2)} src="${newSrc}" />`;
    if (tag.endsWith(">")) return `${tag.slice(0, -1)} src="${newSrc}">`;
    return tag;
  });

  return replaced ? updated : html;
}

export function isExternalImageUrl(value: string | null): boolean {
  if (!value) return false;
  return IMAGE_EXTENSIONS.test(value) && !value.includes("cdn.shopify.com");
}