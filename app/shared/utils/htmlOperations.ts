/**
 * Strip HTML tags and return plain text
 */
export function stripHtml(html: any): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.innerText || "";
}