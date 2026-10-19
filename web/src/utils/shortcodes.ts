import type { Announcement } from "@/api";

/**
 * Fills the shortcodes in a net's rich-text script (the opening or closing statement):
 *   [/TOPIC]         the current session topic (plain text, escaped)
 *   [/ANNOUNCEMENTS] a numbered list of the active announcements, in order
 * Shortcodes are case-insensitive. A [/ANNOUNCEMENTS] alone in its own paragraph
 * replaces the whole paragraph so no empty line is left.
 */
export function parseShortcodes(
  html: string | undefined,
  context: { topic?: string; announcements?: Pick<Announcement, "active" | "text" | "order">[] } = {},
): string {
  if (!html) return "";
  let result = html;

  const topic = context.topic ? escapeHtml(context.topic) : "";
  result = result.replace(/\[\/TOPIC\]/gi, topic);

  const items = (context.announcements || [])
    .filter((a) => a.active)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((a) => `<li>${a.text}</li>`)
    .join("");
  const list = items ? `<ol>${items}</ol>` : "";

  result = result.replace(/<p[^>]*>\s*\[\/ANNOUNCEMENTS\]\s*<\/p>/gi, list);
  result = result.replace(/\[\/ANNOUNCEMENTS\]/gi, list);
  return result;
}

function escapeHtml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
