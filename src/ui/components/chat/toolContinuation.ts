import type { ToolCall } from "../../../types";

interface ToolRoundResult {
  toolCalls: ToolCall[];
  incompleteToolCall: boolean;
  emptyText: boolean;
  finishReason?: string;
}

export async function retryToolRound(
  streamRound: () => Promise<ToolRoundResult>,
  retryEmptyText = false,
  signal?: AbortSignal,
): Promise<ToolCall[]> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return [];
    const result = await streamRound();
    if (signal?.aborted) return [];
    if (result.toolCalls.length === 0 && result.emptyText && result.finishReason === "length") {
      throw new Error("Ollama reached the output token limit before producing an answer or tool call. Increase Max tokens in the local LLM settings (or clear it to use the server default), and check the server's output limit. See the Ollama request/response diagnostics in the developer console.");
    }
    const shouldRetry = result.toolCalls.length === 0 &&
      (result.incompleteToolCall || (retryEmptyText && result.emptyText));
    if (!shouldRetry) return result.toolCalls;
    console.warn(`[llm-hub] Server returned an incomplete tool continuation (${attempt}/${maxAttempts})`, {
      finishReason: result.finishReason ?? "unknown",
      emptyText: result.emptyText,
      incompleteToolCall: result.incompleteToolCall,
      retrying: attempt < maxAttempts,
    });
  }
  throw new Error("The server repeatedly returned an incomplete response after a tool result. See the request/response diagnostics in the developer console for the finish reason and tool result sizes.");
}
