import { App, TFile, requestUrl } from "obsidian";

export interface FunctionCall { function: { name: string; arguments: Record<string, unknown> } }
export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
const param = (description: string) => ({ type: "string", description });
const accessibleNotes = (app: App) => app.vault.getMarkdownFiles().filter(file =>
  !file.path.startsWith(".obsidian/") && !file.path.startsWith("LocalLlmHub/"));

export function mobileToolDefinitions(vault: boolean, web: boolean): ToolDefinition[] {
  const defs: ToolDefinition[] = [];
  if (vault) defs.push(
    { type: "function", function: { name: "list_notes", description: "List Markdown note paths in this vault.", parameters: { type: "object", properties: { filter: param("Optional path filter") } } } },
    { type: "function", function: { name: "read_note", description: "Read one Markdown note by exact vault-relative path.", parameters: { type: "object", properties: { path: param("Exact Markdown note path") }, required: ["path"] } } },
    { type: "function", function: { name: "search_notes", description: "Search Markdown note paths and contents, returning brief excerpts.", parameters: { type: "object", properties: { query: param("Text to find in titles or contents") }, required: ["query"] } } },
  );
  if (web) defs.push({ type: "function", function: { name: "web_search", description: "Search the public web through DuckDuckGo for current information.", parameters: { type: "object", properties: { query: param("Web search query") }, required: ["query"] } } });
  return defs;
}
const argument = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === "string" ? args[key].trim().slice(0, 200) : "";

function resolveSearchUrl(href: string): string {
  try {
    let result = new URL(href, "https://duckduckgo.com");
    if (result.hostname === "duckduckgo.com" && result.pathname.startsWith("/l/")) {
      const target = result.searchParams.get("uddg");
      if (!target) return "";
      result = new URL(target);
    }
    return ["https:", "http:"].includes(result.protocol) ? result.href : "";
  } catch { return ""; }
}

async function searchWeb(query: string): Promise<string> {
  const response = await requestUrl({ url: "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), method: "GET" });
  const html = new DOMParser().parseFromString(response.text, "text/html");
  const results = Array.from(html.querySelectorAll(".result")).slice(0, 8).map(element => {
    const link = element.querySelector<HTMLAnchorElement>(".result__a");
    const url = resolveSearchUrl(link?.getAttribute("href") ?? "");
    const title = link?.textContent?.trim().slice(0, 150) ?? "";
    const snippet = element.querySelector(".result__snippet")?.textContent?.trim().slice(0, 350) ?? "";
    return { title, url, snippet };
  }).filter(item => item.title && item.url).slice(0, 5);
  return results.length ? JSON.stringify(results) : "No search results. Do not invent findings.";
}

export async function executeMobileTool(app: App, name: string, args: Record<string, unknown>, vault: boolean, web: boolean): Promise<string> {
  if (name === "web_search" && web) {
    const query = argument(args, "query");
    if (!query) return "Missing search query.";
    try { return await searchWeb(query); }
    catch (error) { return "Web search unavailable: " + String(error); }
  }
  if (!vault) return "Vault tools are disabled.";
  const notes = accessibleNotes(app);
  if (name === "list_notes") {
    const filter = argument(args, "filter").toLowerCase();
    const matches = filter ? notes.filter(file => file.path.toLowerCase().includes(filter)) : notes;
    return JSON.stringify({ paths: matches.slice(0, 80).map(file => file.path), total: matches.length, truncated: matches.length > 80 });
  }
  if (name === "read_note") {
    const path = argument(args, "path");
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md" || !notes.some(note => note.path === path)) return "Note not found.";
    const content = await app.vault.cachedRead(file);
    return JSON.stringify({ path, content: content.slice(0, 10000), truncated: content.length > 10000 });
  }
  if (name === "search_notes") {
    const query = argument(args, "query").toLowerCase();
    if (!query) return "Missing query.";
    const hits: Array<{ path: string; snippet: string }> = [];
    for (const file of notes.slice(0, 500)) {
      if (file.path.toLowerCase().includes(query)) {
        hits.push({ path: file.path, snippet: "(path match)" });
      } else {
        const content = await app.vault.cachedRead(file);
        const i = content.toLowerCase().indexOf(query);
        if (i >= 0) hits.push({ path: file.path, snippet: content.slice(Math.max(0, i - 100), i + query.length + 250) });
      }
      if (hits.length >= 12) break;
    }
    return JSON.stringify({ results: hits, scannedAtMost: 500, capped: notes.length > 500 });
  }
  return "Unknown or disabled tool: " + name;
}
