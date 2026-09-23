/**
 * markdown.js
 * Render Markdown (blog posts) to safe HTML: marked → DOMPurify.
 */

import { marked } from "https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs";

marked.setOptions({ gfm: true, breaks: false });

// Open external links in a new tab
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && /^https?:\/\//i.test(node.getAttribute("href") || "")
      && !node.getAttribute("href").startsWith(window.location.origin)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(markdown) {
  return DOMPurify.sanitize(marked.parse(String(markdown || "")));
}
