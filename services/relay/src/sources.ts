import type { SessionMessage } from "./hermes-session.js";
import { extractSources, isSourceUrl } from "./prompt.js";

/**
 * A reply's sources (NH-23): the pages the agent searched this turn, so a
 * searched answer shows them even when the agent didn't link them — it
 * rarely does unless asked. The links the reply itself has come first; the
 * turn's web_search results fill up after them, three sources in all.
 *
 * The results are untrusted: what search engines and web pages return. They
 * become the reply's sources (a title and an https URL the app shows under
 * the message) and nothing else — never part of the reply's text.
 */

export interface Source {
  title?: string;
  url: string;
}

export const MAX_SOURCES = 3;
const TITLE_MAX = 120;

/** A page title as plain text: no tags, no markdown, no control characters, one short line. */
export function cleanTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|~[\]]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  if (text.length <= TITLE_MAX) return text;
  return `${Array.from(text).slice(0, TITLE_MAX - 1).join("").trimEnd()}…`;
}

/** web_search's results in the turn's messages, in the order they came (mergeSources drops the repeats). */
export function searchResults(messages: SessionMessage[]): Source[] {
  const out: Source[] = [];
  for (const m of messages) {
    if (m.role !== "tool" || m.tool_name !== "web_search" || typeof m.content !== "string") continue;
    // Hermes wraps a tool's output in <untrusted_tool_result …> with a notice before the JSON.
    const start = m.content.indexOf("{");
    const end = m.content.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    let web: unknown;
    try {
      web = (JSON.parse(m.content.slice(start, end + 1)) as { data?: { web?: unknown } }).data?.web;
    } catch {
      continue;
    }
    if (!Array.isArray(web)) continue;
    for (const r of web as Array<{ title?: unknown; url?: unknown }>) {
      if (typeof r?.url !== "string") continue;
      const title = cleanTitle(r.title);
      out.push(title ? { title, url: r.url } : { url: r.url });
    }
  }
  return out;
}

/** The same page, whatever its fragment, case of host or trailing slash. */
function pageKey(url: string): string {
  const u = new URL(url);
  return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}

/** The reply's own links first, then the search results it doesn't have, at most MAX_SOURCES. */
export function mergeSources(own: Source[], found: Source[]): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const s of [...own, ...found]) {
    if (out.length >= MAX_SOURCES) break;
    if (!isSourceUrl(s.url)) continue;
    const key = pageKey(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** A reply's sources from its text and, when the session could be read, the turn's searches. */
export function replySources(replyText: string, turn: SessionMessage[] | undefined): Source[] {
  return mergeSources(extractSources(replyText), turn ? searchResults(turn) : []);
}
