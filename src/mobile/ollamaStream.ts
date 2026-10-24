import { requestUrl } from "obsidian";

/** Native fetch streams when the Tailscale/Ollama origin allows CORS.
 * Obsidian requestUrl is the reliable non-streaming fallback on Android. */
export async function streamOllama(
  baseUrl: string, payload: Record<string, unknown>, onText: (text: string) => void,
  onStatus: (status: string) => void = () => undefined,
): Promise<string> {
  let accumulated = "";
  onStatus("Connecting for live response…");
  try {
    const response = await fetch(baseUrl + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, stream: true }),
    });
    if (!response.ok) throw new Error("Streaming HTTP " + response.status);
    if (!response.body) throw new Error("Streaming unavailable");
    onStatus("Waiting for Mabel…");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (line: string): void => {
      if (!line.trim()) return;
      const obj = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (obj.error) throw new Error(obj.error);
      if (obj.message?.content) {
        accumulated += obj.message.content;
        onText(accumulated);
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        consume(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!accumulated.trim()) throw new Error("Empty streamed response");
    return accumulated;
  } catch (error) {
    if (accumulated) throw error; // Don't replay a partly displayed answer.
    onStatus("Waiting for reply (buffered connection)…");
    const response = await requestUrl({
      url: baseUrl + "/api/chat",
      method: "POST", contentType: "application/json",
      body: JSON.stringify({ ...payload, stream: false }),
    });
    const json = response.json as { message?: { content?: string } };
    const text = json.message?.content;
    if (!text?.trim()) throw new Error("Ollama returned an empty response.");
    onText(text);
    return text;
  }
}
