import { describe, expect, it } from "vitest";
import type { Message } from "../../../types";
import { buildToolFreeRecoveryMessages } from "./toolRecovery";

const message = (role: Message["role"], content: string, extra: Partial<Message> = {}): Message => ({
  role, content, timestamp: 1, ...extra,
});

describe("tool-free recovery request", () => {
  it("embeds user request and tool output without tool messages", () => {
    const messages = [
      message("user", "Tell me about myself."),
      message("assistant", "", { toolCalls: [{ id: "a", name: "get_user_context", args: {} }] }),
      message("tool", "Details about Anthon", { toolName: "get_user_context", toolCallId: "a" }),
    ];
    const recovered = buildToolFreeRecoveryMessages(messages);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].role).toBe("user");
    expect(recovered[0].content).toContain("Details about Anthon");
    expect(recovered[0].content).toContain("Tell me about myself.");
    expect(messages[0].content).toBe("Tell me about myself.");
  });

  it("never carries executable calls or prior-turn tool outputs", () => {
    const messages = [
      message("user", "first"),
      message("assistant", "", { toolCalls: [{ id: "old", name: "create_note", args: {} }] }),
      message("tool", "previous write", { toolName: "create_note" }),
      message("assistant", "Done."),
      message("user", "Now summarize"),
      message("assistant", "", { toolCalls: [{ id: "new", name: "get_user_context", args: {} }] }),
      message("tool", "current profile", { toolName: "get_user_context" }),
    ];
    const recovered = buildToolFreeRecoveryMessages(messages);
    expect(recovered.every(m => !m.toolCalls?.length && m.role !== "tool")).toBe(true);
    expect(recovered.at(-1)?.content).not.toContain("previous write");
    expect(recovered.at(-1)?.content).toContain("current profile");
  });

  it("caps oversized tool bodies", () => {
    const recovered = buildToolFreeRecoveryMessages([
      message("user", "question"),
      message("tool", "A".repeat(30000), { toolName: "get_user_context" }),
    ], 2000);
    expect(recovered.at(-1)?.content.length).toBeLessThan(2300);
    expect(recovered.at(-1)?.content).toContain("[truncated]");
  });
});
