import { normalizePath, type DataAdapter } from "obsidian";

export interface OllamaRequestCapture {
  requestId: string;
  body: string;
}

export type OllamaRequestWriter = (capture: OllamaRequestCapture) => Promise<void>;

/** Store only the exact request body; never persist connection credentials. */
export function createOllamaRequestWriter(adapter: DataAdapter, pluginDir: string): OllamaRequestWriter {
  const directory = normalizePath(`${pluginDir}/diagnostics`);
  return async ({ requestId, body }) => {
    if (!await adapter.exists(directory)) {
      try {
        await adapter.mkdir(directory);
      } catch (error) {
        // Another chat may have created the directory concurrently.
        if (!await adapter.exists(directory)) throw error;
      }
    }
    const path = normalizePath(`${directory}/ollama-${requestId}.json`);
    await adapter.write(path, body);
    console.debug("[llm-hub] Ollama request saved", { requestId, path });
  };
}
