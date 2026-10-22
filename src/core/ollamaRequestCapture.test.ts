import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "obsidian";

vi.mock("obsidian", () => ({ normalizePath: (path: string) => path.replace(/\\/g, "/") }));
import { createOllamaRequestWriter } from "./ollamaRequestCapture";

afterEach(() => vi.restoreAllMocks());

describe("Ollama request files", () => {
  it("writes a replayable body inside the plugin directory and logs only its path", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const adapter = { exists: vi.fn().mockResolvedValue(false), mkdir: vi.fn(), write: vi.fn() };
    const body = '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"private"}]}';
    await createOllamaRequestWriter(adapter as unknown as DataAdapter, ".obsidian/plugins/local-llm-hub")({ requestId: "123-1", body });
    expect(adapter.mkdir).toHaveBeenCalledWith(".obsidian/plugins/local-llm-hub/diagnostics");
    expect(adapter.write).toHaveBeenCalledWith(".obsidian/plugins/local-llm-hub/diagnostics/ollama-123-1.json", body);
    expect(JSON.stringify(vi.mocked(console.debug).mock.calls)).not.toContain("private");
  });

  it("allows concurrent creation but propagates an actual directory failure", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const adapter = {
      exists: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      mkdir: vi.fn().mockRejectedValue(new Error("already exists")), write: vi.fn(),
    };
    const writer = createOllamaRequestWriter(adapter as unknown as DataAdapter, ".obsidian/plugins/local-llm-hub");
    await writer({ requestId: "123-2", body: "{}" });
    expect(adapter.write).toHaveBeenCalledOnce();
    adapter.exists.mockResolvedValue(false);
    await expect(writer({ requestId: "123-3", body: "{}" })).rejects.toThrow("already exists");
    expect(adapter.write).toHaveBeenCalledOnce();
  });
});
