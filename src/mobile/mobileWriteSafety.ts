export type WriteOperation = "create_note" | "update_note";
export const MAX_APPROVED_NOTE_CHARS = 30000;

export function validateMobileWrite(path: string, content: string, configDir: string): string | null {
  if (typeof path !== "string" || !path || path.length > 240 || path.startsWith("/") || path.includes("\\") || path.includes("//")) {
    return "Invalid vault-relative path.";
  }
  const segments = path.split("/");
  if (segments.some(segment => !segment || segment.startsWith(".") || /[\x00-\x1f]/.test(segment))) {
    return "Dot-prefixed directories and unsafe path segments are not writable.";
  }
  if (segments.some(segment => segment === "." || segment === "..")) return "Path traversal is not allowed.";
  if (!path.endsWith(".md") || segments.length < 1) return "Only Markdown note files can be created or edited.";
  if (path === configDir || path.startsWith(configDir + "/") || path.startsWith("LocalLlmHub/")) {
    return "Plugin settings and generated workspace files are not editable.";
  }
  if (!content.trim()) return "Empty documents must be edited manually.";
  if (content.length > MAX_APPROVED_NOTE_CHARS) return "Proposed content exceeds the 30,000-character approval limit.";
  return null;
}
