import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { CONTEXT_FILES, CONTEXT_PATHS, parseSleepPlan, selectSleepChatFiles, userOnlyTranscript } from "./sleep";
import { messagesToMarkdown } from "obsidian-llm-hub-common/chat";

const sourceIds = new Set(["CHAT-01", "CHAT-02"]);

describe("Mabel sleep model safety", () => {
  it("uses exactly the five reference context filenames", () => {
    expect(CONTEXT_FILES).toHaveLength(5);
    expect(CONTEXT_PATHS.every(path => path.startsWith("Mabel/Memory/Context/CTX-"))).toBe(true);
  });

  it("parses grounded updates and questions", () => {
    const plan = parseSleepPlan(JSON.stringify({
      updates: [{
        file: "CTX-now.md",
        content: "# Current\n- User resumed a project",
        sources: ["CHAT-02", "CHAT-99"],
        reason: "User said they restarted",
      }],
      questions: ["What about the old deadline?"],
      summary: "Updated active project",
    }), sourceIds);
    expect(plan.updates[0].sources).toEqual(["CHAT-02"]);
    expect(plan.questions).toHaveLength(1);
  });

  it("accepts a harmless no-update review", () => {
    expect(parseSleepPlan('{"updates":[],"questions":[],"summary":"Nothing changed"}', new Set()))
      .toMatchObject({ updates: [], summary: "Nothing changed" });
  });

  it("rejects unknown paths and ungrounded changes", () => {
    const plan = (file: string, sources: string[]) => JSON.stringify({
      updates: [{ file, content: "# hello", sources }],
      questions: [], summary: "",
    });
    expect(() => parseSleepPlan(plan("../User.md", ["CHAT-01"]), sourceIds)).toThrow("CTX");
    expect(() => parseSleepPlan(plan("CTX-now.md", ["CHAT-999"]), sourceIds)).toThrow("evidence");
    expect(() => parseSleepPlan(plan("CTX-now.md", []), sourceIds)).toThrow("evidence");
    expect(() => parseSleepPlan(plan("CTX-now.md", ["CHAT-01"]).replace("# hello", "x\n".repeat(60)), sourceIds)).toThrow();
  });

  it("never treats assistant-authored imagination or tool text as user facts", async () => {
    const markdown = await messagesToMarkdown([
      { role: "user", content: "I started a new project today.", timestamp: 1700000000000 },
      { role: "assistant", content: "My name is Mabel, goddess of the vault.", timestamp: 1700000001000 },
      { role: "tool", content: "secret server output", toolName: "read_note", toolCallId: "1", timestamp: 1700000002000 },
    ], "Test", 1700000000000, undefined);
    const extracted = userOnlyTranscript(markdown, 3000);
    expect(extracted).toContain("started a new project");
    expect(extracted).not.toContain("goddess");
    expect(extracted).not.toContain("secret server");
  });

  it("selects only new chats in the configured chat storage folder", () => {
    const fake = (path: string, mtime: number) => ({
      path, extension: path.split(".").at(-1), stat: { mtime },
    }) as unknown as TFile;
    expect(selectSleepChatFiles([
      fake("LocalLlmHub/chats/one.md", 101),
      fake("LocalLlmHub/chats/two.md", 103),
      fake("LocalLlmHub/chats/three.md", 99),
      fake("Mabel/Memory/Projects.md", 110),
    ], "LocalLlmHub/chats", 100).map(x => x.path)).toEqual([
      "LocalLlmHub/chats/one.md", "LocalLlmHub/chats/two.md",
    ]);
  });
});
