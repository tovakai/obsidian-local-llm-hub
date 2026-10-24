import { requestUrl } from "obsidian";

/** Chat thinking effort is separate from Low / Medium / High model selection. */
export type ThinkingEffort = "off" | "brief" | "standard" | "deep";
export const THINKING_EFFORTS: readonly ThinkingEffort[] = ["off", "brief", "standard", "deep"];
export const THINKING_LABELS: Record<ThinkingEffort, string> = {
  off: "Off", brief: "Brief", standard: "Standard", deep: "Deep",
};

export function parseThinkingEffort(value: unknown, oldMode?: "default" | "off" | "on"): ThinkingEffort {
  if (value === "off" || value === "brief" || value === "standard" || value === "deep") return value;
  return oldMode === "off" ? "off" : "standard";
}

export interface ThinkingControl {
  think: boolean | string;
  promptHint: string;
  nativeLevel: boolean;
}
export type OllamaThinkingValues = Array<string | boolean>;

/** Only use named levels advertised by /api/show. Unknown levels silently use defaults. */
export function selectThinkingControl(effort: ThinkingEffort, values?: OllamaThinkingValues): ThinkingControl {
  const names = (values ?? []).filter((value): value is string => typeof value === "string");
  const preferred = effort === "deep" ? ["high", "max", "medium", "low"]
    : effort === "standard" ? ["medium", "high", "low"]
      : ["low", "medium", "high"];
  if (effort === "off") {
    if (values?.length && !values.includes(false) && names.length) {
      return { think: names.includes("low") ? "low" : names[0], promptHint: "", nativeLevel: true };
    }
    return { think: false, promptHint: "", nativeLevel: false };
  }
  const level = preferred.find(name => names.includes(name));
  if (level) return { think: level, promptHint: "", nativeLevel: true };

  // Models with a boolean-only thinking switch cannot enforce thinking-token budgets.
  // The short/long guidance is advisory; never lower max output tokens to mimic a budget.
  const promptHint = effort === "brief"
    ? "\n\nThinking effort: brief. If you use a thinking stage, keep it concise: a few short checks or steps, avoid repeated reconsideration, and move promptly to the final answer. This is a preference, not a strict token limit."
    : effort === "deep"
      ? "\n\nThinking effort: deep. Carefully reason through genuinely difficult parts before providing a clear final answer. Avoid circular repetition."
      : "";
  return { think: true, promptHint, nativeLevel: false };
}

const capabilityCache = new Map<string, { expires: number; values?: OllamaThinkingValues }>();

export async function getOllamaThinkingControl(
  baseUrl: string, model: string, effort: ThinkingEffort,
): Promise<ThinkingControl> {
  const key = baseUrl.replace(/\/+$/, "") + "\n" + model;
  const cached = capabilityCache.get(key);
  if (cached && cached.expires > Date.now()) return selectThinkingControl(effort, cached.values);
  try {
    const response = await requestUrl({
      url: baseUrl.replace(/\/+$/, "") + "/api/show",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ model }),
    });
    const info: unknown = response.json;
    let values: OllamaThinkingValues | undefined;
    if (info && typeof info === "object" && "thinking" in info) {
      const meta = info.thinking;
      if (meta && typeof meta === "object" && "values" in meta && Array.isArray(meta.values)) {
        values = meta.values.filter((value): value is string | boolean =>
          typeof value === "string" || typeof value === "boolean");
      }
    }
    capabilityCache.set(key, { values, expires: Date.now() + 5 * 60_000 });
    return selectThinkingControl(effort, values);
  } catch {
    // Older Ollama builds and proxies may lack /api/show; safe boolean fallback.
    capabilityCache.set(key, { expires: Date.now() + 30_000 });
    return selectThinkingControl(effort);
  }
}
