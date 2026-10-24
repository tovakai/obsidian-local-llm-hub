import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.hoisted(() => vi.fn());
vi.mock("obsidian", () => ({ requestUrl }));

import { streamOllama } from "./ollamaStream";

const encoder = new TextEncoder();
function responseLines(...lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return { ok: true, body, status: 200 } as Response;
}
const body = { model: "mabel", messages: [{ role: "user", content: "Hello" }] };
let partial: string[];

beforeEach(() => { partial = []; requestUrl.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("mobile Ollama streaming", () => {
  it("renders partial NDJSON chunks progressively", async () => {
    const first = JSON.stringify({ message: { content: "Hel" }, done: false }) + "\n";
    const second = JSON.stringify({ message: { content: "lo!" }, done: true }) + "\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseLines(first.slice(0, 13), first.slice(13) + second)));
    await expect(streamOllama("https://private.example", body, text => partial.push(text))).resolves.toBe("Hello!");
    expect(partial).toEqual(["Hel", "Hello!"]);
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("falls back to requestUrl when browser fetch is blocked by CORS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    requestUrl.mockResolvedValue({ json: { message: { content: "Buffered reply" } } });
    await expect(streamOllama("https://private.example", body, text => partial.push(text))).resolves.toBe("Buffered reply");
    expect(requestUrl).toHaveBeenCalledOnce();
    expect(JSON.parse(requestUrl.mock.calls[0][0].body)).toMatchObject({ model: "mabel", stream: false });
    expect(partial).toEqual(["Buffered reply"]);
  });

  it("never resends a partly streamed request", async () => {
    let reads = 0;
    const bodyStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (reads++ === 0) controller.enqueue(encoder.encode(JSON.stringify({ message: { content: "Partial" } }) + "\n"));
        else controller.error(new Error("broken connection"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: bodyStream }));
    await expect(streamOllama("https://private.example", body, text => partial.push(text))).rejects.toThrow();
    expect(requestUrl).not.toHaveBeenCalled();
  });
});
