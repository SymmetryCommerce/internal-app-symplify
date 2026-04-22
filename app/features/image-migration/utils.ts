/* =========================
   IMAGE EDITOR COMPONENT
========================= */

import { IMG_TAG_REGEX } from "./constants";
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